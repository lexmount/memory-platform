FROM node:22-bookworm-slim AS ui
RUN corepack enable
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./
COPY provider-ui /src/provider-ui
RUN npm --prefix /src/provider-ui/openviking ci
RUN pnpm build

FROM golang:1.26 AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /memory ./cmd/memory

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /memory /memory
COPY --from=ui /src/web/dist /ui
ENV MEMORY_LISTEN=0.0.0.0:8080 MEMORY_UI_DIR=/ui
EXPOSE 8080
ENTRYPOINT ["/memory"]
