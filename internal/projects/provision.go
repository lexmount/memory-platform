package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/lexmount/memory-platform/internal/crypto"
	native "github.com/lexmount/memory-platform/internal/native"
	"github.com/lexmount/memory-platform/internal/nativehttp"
	"github.com/lexmount/memory-platform/internal/store"
)

func (s *Service) inspect(ctx context.Context, c *Connection, method, path string, headers http.Header, body any) (int, native.Object, error) {
	var input native.Request
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		input.JSON = data
	}
	response, err := s.client.Call(ctx, c.Config.Endpoint, method, path, input, headers)
	if err != nil {
		return 0, nil, err
	}
	data, err := nativehttp.Inspect(response)
	if err != nil {
		return 0, nil, err
	}
	obj, err := nativehttp.Object(data)
	if err != nil {
		return response.StatusCode, nil, ErrUnavailable
	}
	return response.StatusCode, obj, nil
}
func (s *Service) provision(ctx context.Context, c *Connection, p *store.MemoryProject, u *store.MemoryProjectUser) error {
	i := &Identity{Project: p, User: u, Mapping: mapping(c, p, u), connection: c, key: c.Config.APIKey}
	headers := s.headers(i)
	if p.Provider == "hindsight" {
		status, obj, err := s.inspect(ctx, c, "GET", "/version", headers, nil)
		if err != nil || status != 200 || !supportedHindsightVersion(nativehttp.String(obj, "api_version")) {
			return ErrUnavailable
		}
		path := "/v1/default/banks/" + url.PathEscape(i.Mapping["bank_id"])
		status, obj, err = s.inspect(ctx, c, "GET", path+"/config", headers, nil)
		if err != nil {
			return err
		}
		switch status {
		case 200:
			if nativehttp.String(obj, "bank_id") != i.Mapping["bank_id"] {
				return ErrDenied
			}
		case 404:
			status, _, err = s.inspect(ctx, c, "PUT", path, headers, map[string]any{})
			if err != nil || status < 200 || status >= 300 {
				return ErrUnavailable
			}
			status, obj, err = s.inspect(ctx, c, "GET", path+"/config", headers, nil)
			if err != nil || status != 200 || nativehttp.String(obj, "bank_id") != i.Mapping["bank_id"] {
				return ErrUnavailable
			}
		default:
			return ErrUnavailable
		}
		return nil
	}
	// The root credential is used exclusively by this provisioning path. It is
	// never projected into a user request, including HTTP and native MCP.
	status, obj, err := s.inspect(ctx, c, "GET", "/health", headers, nil)
	if err != nil || status != 200 || nativehttp.String(obj, "version") != c.catalog.Version || nativehttp.String(obj, "auth_mode") != "api_key" {
		return ErrUnavailable
	}
	account := "/api/v1/admin/accounts/" + url.PathEscape(i.Mapping["account_id"])
	if !p.Provisioned {
		status, _, err = s.inspect(ctx, c, "POST", "/api/v1/admin/accounts", headers, map[string]string{"account_id": i.Mapping["account_id"], "admin_user_id": "platform_admin"})
		if err != nil {
			return err
		}
		if status == 409 {
			status, _, err = s.inspect(ctx, c, "GET", account, headers, nil)
		}
		if err != nil || status < 200 || status >= 300 {
			return ErrUnavailable
		}
	}
	status, obj, err = s.inspect(ctx, c, "POST", account+"/users", headers, map[string]string{"user_id": i.Mapping["user_id"], "role": "user"})
	if err != nil {
		return err
	}
	if status == 409 {
		// A previous native creation can outlive a failed local transaction.
		// This deterministic identity has never been released to callers until
		// its encrypted key is committed. Recover only this user's credential.
		status, obj, err = s.inspect(ctx, c, "POST", account+"/users/"+url.PathEscape(i.Mapping["user_id"])+"/key", headers, map[string]any{})
	}
	if err != nil || status < 200 || status >= 300 {
		return ErrUnavailable
	}
	result, err := nativehttp.Object(obj["result"])
	if err != nil {
		return ErrUnavailable
	}
	key := nativehttp.String(result, "user_key")
	if key == "" {
		return ErrUnavailable
	}
	i.key = key
	if err := s.verifyOV(ctx, i); err != nil {
		return err
	}
	u.ProviderKey, err = crypto.EncryptStrict(key, s.encKey)
	return err
}

// The project proxy discovers native operations from OpenAPI. These releases
// have verified canonical Bank configuration and bank-scoped MCP semantics.
// Keep the legacy Agent/Admin compatibility profile independent.
func supportedHindsightVersion(version string) bool {
	return version == "0.10.3" || version == "1.1.0"
}

func (s *Service) verifyOV(ctx context.Context, i *Identity) error {
	status, obj, err := s.inspect(ctx, i.connection, "GET", "/health", s.headers(i), nil)
	if err != nil || status != 200 || nativehttp.String(obj, "version") != i.connection.catalog.Version || nativehttp.String(obj, "auth_mode") != "api_key" || nativehttp.String(obj, "account_id") != i.Mapping["account_id"] || nativehttp.String(obj, "user_id") != i.Mapping["user_id"] || nativehttp.String(obj, "role") != "user" {
		return ErrUnavailable
	}
	return nil
}
