package api

import (
	_ "embed"
	"net/http"
)

//go:embed openapi.json
var openAPI []byte

func RegisterOpenAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(openAPI)
	})
}
