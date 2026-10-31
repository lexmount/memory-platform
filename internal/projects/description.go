package projects

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"

	native "github.com/lexmount/memory-platform/internal/native"
	"github.com/lexmount/memory-platform/internal/nativehttp"
)

// Describe uses the provider's OpenAPI for the console only. MCP discovery is
// always forwarded to the native MCP server and never generated from HTTP.
func (s *Service) Describe(ctx context.Context, i *Identity) (*Description, error) {
	c := i.connection
	c.mu.Lock()
	cached := c.description
	c.mu.Unlock()
	if cached != nil {
		return cached, nil
	}
	// Network I/O must not hold the connection cache lock. Concurrent cold
	// requests may fetch independently and can each honor their own context.
	response, err := s.client.Call(ctx, c.Config.Endpoint, "GET", "/openapi.json", native.Request{}, s.headers(i))
	if err != nil {
		return nil, err
	}
	data, err := nativehttp.Inspect(response)
	if err != nil || response.StatusCode != 200 {
		return nil, ErrUnavailable
	}
	var doc struct {
		Info struct {
			Version string `json:"version"`
		} `json:"info"`
		Paths      map[string]map[string]json.RawMessage `json:"paths"`
		Components json.RawMessage                       `json:"components"`
	}
	if json.Unmarshal(data, &doc) != nil || len(doc.Paths) == 0 {
		return nil, ErrUnavailable
	}
	d := &Description{Provider: c.Config.Provider, Version: c.catalog.Version, Operations: []Operation{}}
	// OpenViking's OpenAPI info is the API schema version (0.1.0), not
	// the native server release reported by /health.
	if c.Config.Provider == "hindsight" && supportedHindsightVersion(doc.Info.Version) {
		d.Version = doc.Info.Version
	}
	// Feature availability is runtime configuration, not the existence of an OpenAPI route.
	if c.Config.Provider == "hindsight" {
		status, version, err := s.inspect(ctx, c, "GET", "/version", s.headers(i), nil)
		if err != nil || status != 200 {
			return nil, ErrUnavailable
		}
		d.Features = map[string]bool{}
		var features map[string]json.RawMessage
		if json.Unmarshal(version["features"], &features) == nil {
			for key, value := range features {
				var enabled bool
				if json.Unmarshal(value, &enabled) == nil {
					d.Features[key] = enabled
				}
			}
		}
	}
	schemas := map[string]json.RawMessage{}
	for path, methods := range doc.Paths {
		for method, raw := range methods {
			method = strings.ToUpper(method)
			if !routeAllowed(c.Config.Provider, method, path) {
				continue
			}
			var entry struct {
				OperationID string `json:"operationId"`
				Summary     string `json:"summary"`
				Description string `json:"description"`
				RequestBody struct {
					Content map[string]json.RawMessage `json:"content"`
				} `json:"requestBody"`
			}
			if json.Unmarshal(raw, &entry) != nil {
				continue
			}
			id := strings.ToLower(method) + "_" + strings.NewReplacer("/", "_", "{", "", "}", "", "-", "_").Replace(strings.Trim(path, "/"))
			// Stable aliases let existing guided pages use their native operations.
			for _, known := range c.catalog.Operations {
				if known.Method == method && known.Path == path {
					id = known.ID
					break
				}
			}
			media := []string{}
			for m := range entry.RequestBody.Content {
				media = append(media, m)
			}
			sort.Strings(media)
			permission := "memory.update"
			if method == "GET" || method == "HEAD" {
				permission = "memory.read"
			}
			if method == "DELETE" {
				permission = "memory.delete"
			}
			description := entry.Description
			if description == "" {
				description = entry.Summary
			}
			d.Operations = append(d.Operations, Operation{ID: id, Method: method, Path: path, Description: description, RequestMedia: media, Permission: permission})
			schema, err := json.Marshal(map[string]json.RawMessage{"operation": raw, "components": doc.Components})
			if err != nil {
				return nil, err
			}
			schemas[id] = schema
		}
	}
	sort.Slice(d.Operations, func(a, b int) bool { return d.Operations[a].ID < d.Operations[b].ID })
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.description == nil {
		c.description = d
		c.schemas = schemas
	}
	return c.description, nil
}
func (s *Service) Schema(ctx context.Context, i *Identity, id string) (json.RawMessage, error) {
	if _, err := s.Describe(ctx, i); err != nil {
		return nil, err
	}
	i.connection.mu.Lock()
	defer i.connection.mu.Unlock()
	data, ok := i.connection.schemas[id]
	if !ok {
		return nil, ErrInvalid
	}
	return data, nil
}
func (s *Service) Operation(ctx context.Context, i *Identity, id string) (Operation, error) {
	d, err := s.Describe(ctx, i)
	if err != nil {
		return Operation{}, err
	}
	for _, op := range d.Operations {
		if op.ID == id {
			return op, nil
		}
	}
	return Operation{}, ErrInvalid
}

// ConsoleRequest decodes transport fields without changing numeric literals.
// It is a browser BFF helper, never the public native HTTP or MCP contract.
func ConsoleRequest(data []byte) (native.Request, error) {
	var input struct {
		Path    map[string]json.RawMessage `json:"path"`
		Query   map[string]json.RawMessage `json:"query"`
		Headers map[string]string          `json:"headers"`
		Body    json.RawMessage            `json:"body"`
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || !errors.Is(d.Decode(new(any)), io.EOF) || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return native.Request{}, ErrInvalid
	}
	r := native.Request{Path: map[string]string{}, Query: map[string][]string{}, Headers: input.Headers, JSON: input.Body}
	scalar := func(raw json.RawMessage) (string, error) {
		var text string
		if json.Unmarshal(raw, &text) == nil && string(raw) != "null" {
			return text, nil
		}
		var n json.Number
		if json.Unmarshal(raw, &n) == nil && string(raw) != "null" {
			return n.String(), nil
		}
		if string(raw) == "true" || string(raw) == "false" {
			return string(raw), nil
		}
		return "", ErrInvalid
	}
	for k, v := range input.Path {
		value, err := scalar(v)
		if err != nil {
			return r, err
		}
		r.Path[k] = value
	}
	for k, v := range input.Query {
		var values []json.RawMessage
		if len(v) > 0 && v[0] == '[' {
			if json.Unmarshal(v, &values) != nil {
				return r, ErrInvalid
			}
		} else {
			values = []json.RawMessage{v}
		}
		for _, raw := range values {
			value, err := scalar(raw)
			if err != nil {
				return r, err
			}
			r.Query.Add(k, value)
		}
	}
	return r, nil
}
func ConsolePath(i *Identity, op Operation, input native.Request) (string, error) {
	if strings.Contains(op.Path, "{bank_id}") {
		if id := input.Path["bank_id"]; id != "" && id != i.Mapping["bank_id"] {
			return "", ErrDenied
		}
		input.Path["bank_id"] = i.Mapping["bank_id"]
	}
	return nativehttp.Path(op.Path, input.Path)
}
