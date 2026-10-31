package projects

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

// Config is a service-owned Provider connection. It has no deployment tenant,
// Agent, scope or platform role configuration.
type Config struct {
	Provider               string
	Endpoint               string
	APIKey                 string
	NamespacePrefix        string
	HindsightStorageTenant string
}

func LoadConfig(getenv func(string) string) (Config, error) {
	c := Config{Provider: getenv("PROVIDER"), Endpoint: strings.TrimRight(getenv("URL"), "/"), APIKey: getenv("API_KEY"), NamespacePrefix: getenv("NAMESPACE_PREFIX"), HindsightStorageTenant: getenv("STORAGE_TENANT")}
	if c.Provider != "hindsight" && c.Provider != "openviking" {
		return c, errors.New("unsupported Memory provider")
	}
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return c, errors.New("invalid Memory provider URL")
	}
	if c.NamespacePrefix == "" {
		c.NamespacePrefix = "memory"
	}
	if !regexp.MustCompile(`^[a-z][a-z0-9_-]{0,15}$`).MatchString(c.NamespacePrefix) {
		return c, errors.New("invalid Memory namespace prefix")
	}
	if c.APIKey == "" || strings.ContainsAny(c.APIKey, "\r\n\x00") {
		return c, errors.New("Memory provider key is required")
	}
	return c, nil
}
