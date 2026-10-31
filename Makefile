.PHONY: build test

build:
	cd web && pnpm build
	go build -trimpath -o memory-server ./cmd/memory

test:
	go test -race ./...
	cd web && pnpm test
