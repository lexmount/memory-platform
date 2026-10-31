package api

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestMemoryProjectsOpenAPI(t *testing.T) {
	raw, err := os.ReadFile("openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	type operation struct {
		Security  []map[string][]string `json:"security"`
		Responses map[string]struct {
			Headers map[string]any `json:"headers"`
			Content map[string]any `json:"content"`
		} `json:"responses"`
	}
	var spec struct {
		Paths      map[string]map[string]json.RawMessage `json:"paths"`
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path string }{
		{"get", "/providers"}, {"get", "/projects"}, {"post", "/projects"}, {"get", "/projects/{project}"}, {"patch", "/projects/{project}"},
		{"get", "/projects/{project}/users"}, {"post", "/projects/{project}/identity"}, {"get", "/projects/{project}/schemas/{operation}"}, {"post", "/projects/{project}/requests/{operation}"},
		{"post", "/projects/{project}/credentials/rotate"}, {"delete", "/projects/{project}/credentials"},
	} {
		data, ok := spec.Paths["/v1"+route.path][route.method]
		var op operation
		if !ok || json.Unmarshal(data, &op) != nil || len(op.Security) == 0 {
			t.Errorf("missing authenticated route: %+v", route)
		}
	}
	for _, path := range []string{"/v1/developer/memory/subjects", "/v1/developer/memory/{provider}/subject", "/v1/developer/memory/{provider}/initialize", "/v1/developer/memory/{provider}/operations/{operation}"} {
		if _, ok := spec.Paths[path]; ok {
			t.Errorf("retired route documented: %s", path)
		}
	}
	if _, ok := spec.Components.Schemas["DeveloperMemoryRequest"]; ok {
		t.Fatal("retired scope envelope remains")
	}
	if schema := string(spec.Components.Schemas["MemoryProjectConsoleRequest"]); strings.Contains(schema, `"scope"`) || strings.Contains(schema, `"native"`) {
		t.Fatal("console still requires old envelope")
	}
	for _, item := range []struct{ path, method, status string }{
		{"/v1/account", "get", "200"}, {"/v1/account/keys", "get", "200"}, {"/v1/account/keys", "post", "201"},
	} {
		var op operation
		if err := json.Unmarshal(spec.Paths[item.path][item.method], &op); err != nil || op.Responses[item.status].Content["application/json"] == nil {
			t.Fatalf("account response contract missing: %+v", item)
		}
	}
	for _, path := range []string{"/v1/memory/identity", "/mcp/memory", "/v1/memory/native/{path}"} {
		for method, data := range spec.Paths[path] {
			var op operation
			if err := json.Unmarshal(data, &op); err != nil {
				t.Fatal(err)
			}
			if len(op.Security) != 1 {
				t.Fatalf("%s %s requires project auth", method, path)
			}
			for _, key := range []string{"memoryAppKey", "memoryAppSecret"} {
				if _, ok := op.Security[0][key]; !ok {
					t.Errorf("%s %s missing %s", method, path, key)
				}
			}
			if path != "/v1/memory/identity" {
				r := op.Responses["default"]
				if r.Headers["X-Memory-Native-Status"] == nil || r.Content["application/octet-stream"] == nil || r.Content["text/event-stream"] == nil {
					t.Errorf("%s %s loses native transport", method, path)
				}
			}
		}
	}
}
