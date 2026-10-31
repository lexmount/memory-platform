// Package profiles pins compatibility versions and native HTTP operation aliases.
// It does not define MCP schemas, permission scopes or business request envelopes.
package profiles

import (
	"embed"
	"encoding/json"
	"fmt"
)

//go:embed hindsight/manifest.json openviking/manifest.json
var manifests embed.FS

type Operation struct {
	ID     string `json:"id"`
	Method string `json:"method"`
	Path   string `json:"path"`
}
type Catalog struct {
	Version    string      `json:"version"`
	Operations []Operation `json:"operations"`
}

func Load(provider string) (*Catalog, error) {
	if provider != "hindsight" && provider != "openviking" {
		return nil, fmt.Errorf("unsupported provider %q", provider)
	}
	data, err := manifests.ReadFile(provider + "/manifest.json")
	if err != nil {
		return nil, err
	}
	var result Catalog
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
