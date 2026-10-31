// Package nativehttp supplies transport safety, not a shared memory API.
package nativehttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	native "github.com/lexmount/memory-platform/internal/native"
	"github.com/lexmount/memory-platform/internal/security"
)

type Client struct {
	http    *http.Client
	timeout time.Duration
	limit   int64
}

func New(client *http.Client, timeout time.Duration, limit int64) (*Client, error) {
	if timeout < 0 || limit < 0 {
		return nil, Fail("invalid", "negative transport option", false)
	}
	if timeout == 0 {
		timeout = 120 * time.Second
	}
	if limit == 0 {
		limit = 64 << 20
	}
	if client == nil {
		client = security.NewSafeClient(timeout)
	}
	copy := *client
	transport := copy.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	if standard, ok := transport.(*http.Transport); ok {
		isolated := standard.Clone()
		// Some native GETs (session auto_create) have write effects. A fresh
		// connection prevents net/http replay on a stale reused connection.
		isolated.DisableKeepAlives = true
		isolated.Protocols = new(http.Protocols)
		isolated.Protocols.SetHTTP1(true)
		copy.Transport = isolated
	}
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{http: &copy, timeout: timeout, limit: limit}, nil
}

func Fail(kind, reason string, dispatched bool) error {
	return &native.Failure{Kind: kind, Reason: reason, Dispatched: dispatched}
}

// Preflight reports failures before the requested business operation is sent.
// A verification GET reaching the provider is not an uncertain business write.
func Preflight(err error) error {
	var failure *native.Failure
	if errors.As(err, &failure) {
		return Fail(failure.Kind, failure.Reason, false)
	}
	return Fail("transport", "native preflight failed", false)
}

// Path expands only declared placeholders. Escaping IDs preserves URL/document
// identifiers; rejecting traversal components prevents proxy double-decoding
// from changing the trusted bank or endpoint path.
func Path(template string, parameters map[string]string) (string, error) {
	for name, value := range parameters {
		placeholder := "{" + name + "}"
		if !strings.Contains(template, placeholder) {
			return "", Fail("invalid", "unexpected native path parameter", false)
		}
		decoded := value
		for depth := 0; ; depth++ {
			if strings.TrimSpace(decoded) == "" || strings.ContainsAny(decoded, "\\\x00\r\n") {
				return "", Fail("invalid", "invalid native identifier", false)
			}
			for part := range strings.SplitSeq(decoded, "/") {
				if part == "." || part == ".." {
					return "", Fail("invalid", "native path traversal", false)
				}
			}
			next := decodeEscapes(decoded)
			if next == decoded {
				// Literal percent signs are valid native IDs; PathEscape below
				// preserves them. Only actual decodable traversal is rejected.
				break
			}
			if depth == 8 {
				return "", Fail("invalid", "ambiguous native identifier encoding", false)
			}
			decoded = next
		}
		template = strings.ReplaceAll(template, placeholder, url.PathEscape(value))
	}
	if strings.ContainsAny(template, "{}") {
		return "", Fail("invalid", "missing native path parameter", false)
	}
	return template, nil
}

// Tolerant intermediaries can decode valid escapes even beside a literal "%".
// Inspect that interpretation too, while retaining the original wire identifier.
func decodeEscapes(value string) string {
	var out strings.Builder
	for i := 0; i < len(value); i++ {
		if value[i] == '%' && i+2 < len(value) {
			if b, err := strconv.ParseUint(value[i+1:i+3], 16, 8); err == nil {
				out.WriteByte(byte(b))
				i += 2
				continue
			}
		}
		out.WriteByte(value[i])
	}
	return out.String()
}

func (c *Client) Call(ctx context.Context, endpoint, method, path string, input native.Request, headers http.Header) (*native.Response, error) {
	if err := ctx.Err(); err != nil {
		return nil, Fail("transport", "cancelled before dispatch", false)
	}
	u, pinned, err := security.Validate(strings.TrimRight(endpoint, "/") + path)
	if err != nil {
		return nil, Fail("endpoint", "provider endpoint rejected", false)
	}
	u.RawQuery = input.Query.Encode()
	ctx, cancel := context.WithTimeout(security.WithPinnedIP(ctx, pinned), c.timeout)
	var body io.Reader
	if input.Upload != nil {
		body = input.Upload
	} else if len(input.JSON) > 0 {
		body = bytes.NewReader(input.JSON)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		cancel()
		return nil, Fail("invalid", "invalid native request", false)
	}
	req.GetBody = nil
	for name, values := range headers {
		req.Header[name] = append([]string(nil), values...)
	}
	for name, value := range input.Headers {
		req.Header.Set(name, value)
	}
	if input.Upload != nil {
		req.Header.Set("Content-Type", input.ContentType)
	} else if len(input.JSON) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		cancel()
		return nil, Fail("transport", "provider request failed; outcome may be unknown", true)
	}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		closeErr := resp.Body.Close()
		cancel()
		if closeErr != nil {
			return nil, Fail("transport", "redirect response close failed", true)
		}
		return nil, Fail("endpoint", "provider redirect rejected", true)
	}
	content := make(http.Header)
	for _, name := range []string{"Content-Type", "Content-Disposition", "Content-Length", "Content-Encoding", "X-Content-Type-Options", "ETag", "Last-Modified", "Cache-Control", "Retry-After", "X-Request-ID", "Deprecation", "Link", "Mcp-Session-Id", "Mcp-Protocol-Version", "Allow", "Accept-Ranges", "Content-Range"} {
		if values := resp.Header.Values(name); len(values) > 0 {
			content[http.CanonicalHeaderKey(name)] = append([]string(nil), values...)
		}
	}
	return &native.Response{StatusCode: resp.StatusCode, Header: content, Body: &responseBody{body: resp.Body, cancel: cancel, remaining: c.limit}}, nil
}

type responseBody struct {
	body      io.ReadCloser
	cancel    context.CancelFunc
	remaining int64
}

func (b *responseBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.remaining == 0 {
		var probe [1]byte
		n, err := b.body.Read(probe[:])
		if n > 0 {
			b.cancel()
			return 0, Fail("limit", "native response exceeds configured limit", true)
		}
		if err != nil {
			b.cancel()
		}
		return 0, streamError(err)
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.body.Read(p)
	b.remaining -= int64(n)
	if err != nil {
		b.cancel()
	}
	return n, streamError(err)
}
func (b *responseBody) Close() error { b.cancel(); return streamError(b.body.Close()) }

func streamError(err error) error {
	if err == nil || errors.Is(err, io.EOF) {
		return err
	}
	return Fail("transport", "native response stream failed; outcome may be unknown", true)
}

// Inspect buffers only verification responses, preserving original bytes for
// callers that subsequently release the validated native response.
func Inspect(resp *native.Response) (data []byte, err error) {
	defer func() {
		if e := resp.Body.Close(); err == nil && e != nil {
			err = Fail("transport", "native response close failed", true)
		}
	}()
	data, err = io.ReadAll(resp.Body)
	if err != nil {
		return nil, Fail("transport", "native response read failed", true)
	}
	return data, nil
}

func Object(data []byte) (native.Object, error) {
	var v native.Object
	if err := json.Unmarshal(data, &v); err != nil || v == nil {
		return nil, Fail("identity", "invalid native verification response", true)
	}
	return v, nil
}
func String(o native.Object, key string) string {
	var s string
	if err := json.Unmarshal(o[key], &s); err != nil {
		return ""
	}
	return s
}

func Buffered(resp *native.Response, data []byte) *native.Response {
	resp.Body = io.NopCloser(bytes.NewReader(data))
	return resp
}
