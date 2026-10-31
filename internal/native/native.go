package native

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// Object retains native extension fields and numeric literals without float64 coercion.
type Object map[string]json.RawMessage

// Request is transport material only. Provider-specific methods and schemas
// define its business shape. Path never contains bank/account/user authority.
// JSON is kept verbatim. Upload is used only for native non-JSON bodies; callers
// own its lifetime. No arbitrary URL, method, header or credential is accepted.
type Request struct {
	Path  map[string]string
	Query url.Values
	// Only native business headers declared by the operation schema are accepted.
	// Authentication and namespace headers are always supplied by the adapter.
	Headers     map[string]string
	JSON        json.RawMessage
	Upload      io.Reader
	ContentType string
}

// Response retains native status, bytes and content headers, including errors,
// task states and streams. Caller MUST close Body. No memory/result wrapper is
// inserted. Go errors represent platform validation or transport failures only.
type Response struct {
	StatusCode int
	Header     http.Header
	Body       io.ReadCloser
}

// Failure describes a platform/transport failure, never a provider HTTP error.
// Dispatched means a write MAY have reached the provider; never blindly retry it.
type Failure struct {
	Kind, Reason string
	Dispatched   bool
}

func (e *Failure) Error() string { return "memory " + e.Kind + ": " + e.Reason }

// RetryableHTTPStatus classifies temporary native HTTP failures. It does not
// authorize replaying a write; callers must first reconcile its native receipt.
func RetryableHTTPStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= http.StatusInternalServerError
}
