# Memory Platform

A standalone Memory service with its own Go module, browser console and build. It owns accounts,
projects, credentials and native user mappings in a **separate PostgreSQL database**.
It has no dependency on the InsightFlow repository, tenant model, RBAC or Gateway.
Provider business data remains in Hindsight / OpenViking.

## Run

```sh
cd web
pnpm install --frozen-lockfile
pnpm build
cd ..
go build -o memory-server ./cmd/memory
# Supply the variables in .env.example through your process manager.
./memory-server
```

`MEMORY_DATABASE_URL` must point to an empty, dedicated database on PostgreSQL 18.
Startup applies the service's own schema under a cross-process migration lock. It
refuses a database containing the InsightFlow platform schema. `memory-server migrate`
applies only these migrations without starting HTTP. The database may share a PostgreSQL
server with other applications; it must not share their database/schema.

UI and API share one origin/listener. `/healthz` checks the database; `/openapi.json`
describes management and native transport. For UI development, use `pnpm dev`,
listen on `127.0.0.1:19444` in Go and set `MEMORY_PUBLIC_URL=http://127.0.0.1:19442`.
For containers, build from the repository root with
`docker build -t memory-platform .`.

## Login and account API keys

Login follows **Lexmount Identity SDK 0.1.0 server mode**. The credential-free
`browser/server-client.ts` is vendored in `web/src/identity-client.ts`.
A local helper patch preserves the current session during focus revalidation;
cross-tab identity announcements still immediately clear old state. Management UI
requests carry `X-Memory-Account` as an expected account guard, never authentication.
The Go adapter uses the repository's `go-oidc` and `oauth2` libraries for the same
authorization-code + PKCE / state / nonce flow. There is one callback owner, with
no Node sidecar and no password database. Source and contract:
[Identity integration manual](https://yours.lexmount.com/artifact-site/v/UEJhkMe_VYze9KCEoJzyYbT15JkKop7P).

Configure the issuer, client ID and server-only secret. Register the exact public
origin and `<MEMORY_PUBLIC_URL>/auth/callback` with the SSO administrator. Production
requires HTTPS; localhost HTTP is accepted for the SDK's registered development
callback. Do not put SDK development secrets in Git, frontend variables or images.

Accounts are associated by **issuer + subject**, never by email. Sessions, callback
transactions and logout preferences are persisted in PostgreSQL. A hashed opaque
HttpOnly cookie identifies the browser; its local login lasts eight hours. Transactions
serialize across replicas and atomically associate the account/session. Callback
exchange occurs outside the lock, then rechecks the login generation. Logout and
account switching invalidate pending flows; automatic login honors explicit logout.
Logout affects Memory only, not other SSO applications.

The console can create/list/revoke account API keys. These `ma_` keys authenticate
management APIs with `Authorization: Bearer <key>`; only their hashes are stored.
The secret is returned once. Management checks account ownership, without roles or
grants. Browser mutations require an exact same-origin `Origin` header.

## Projects and native access

1. Sign in and create a project using one configured Provider.
2. Save its App Key and App Secret (the secret is shown once).
3. Connect your application using `X-App-Key`, `X-App-Secret` and `X-User-Id`.
4. The first request provisions the native user. Connected users then appear in
   the console; the console never asks you to pre-create arbitrary user IDs.

Percent-encode `X-User-Id` as a URL path component, e.g. `encodeURIComponent(userid)`.
Project credentials and account API keys are separate and cannot substitute for
each other. End users do not need Memory or InsightDev accounts.

- `POST /v1/memory/identity`: resolve/provision the project/user mapping.
- `/v1/memory/native/<native path>`: native HTTP transport.
- `/mcp/memory`: native MCP, including streaming/session transport.
- `/v1/projects`, `/v1/providers`, `/v1/account/keys`: account management.

Hindsight uses a bank per project/user. OpenViking uses an account per project and a
native user per external user ID. Its native user key is encrypted with
`MEMORY_ENCRYPTION_KEY`; only provisioning uses the configured root key. OpenViking
must run in `api_key` mode. Keep the encryption key stable across replicas/restarts.
An existing legacy `trusted`-mode instance needs a separate `api_key` instance.

Provider HTTP bodies, MCP tool schemas, large numbers, binary responses and SSE
remain native. Identity/header/bank boundaries are enforced at the proxy; no scope
envelope is introduced. Native response status is in `X-Memory-Native-Status`;
service rejections have `memory_*` error codes and a `dispatched` flag. Writes are
never automatically retried. MCP session IDs bind project, user and credential
version; rotation/revocation takes effect on subsequent requests. In-flight Provider
work cannot be undone by rotating a key.

## Moving from the former monorepo build

Keep the existing Memory database, `MEMORY_ENCRYPTION_KEY`, Provider URLs and
namespace prefixes, and SSO settings. Accounts, project UUIDs, App Keys, User Keys,
MCP sessions and native bank/account/user mappings keep working; no data copy or
Provider reprovisioning is needed. The service schema remains version 1.
Rename `GOCLAW_ALLOW_PRIVATE_IP` to `MEMORY_ALLOW_PRIVATE_IP` if the Providers use
trusted LAN addresses. Keep the public origin/callback unchanged, or register the
new exact callback with the SSO administrator before moving domains.

InsightFlow retains only its legacy Agent/Admin/Hooks integration and Built-in
Memory. Those are not part of this repository. Its prototype-table cleanup runs
against the platform database separately, never against this service's database.

## Repository boundaries

- `cmd/memory`: standalone startup and same-origin UI hosting.
- `internal/auth`, `api`, `store`: SSO, account/project APIs and own database schema.
- `internal/projects`: identity mapping, provisioning and native HTTP/MCP proxy.
- `internal/profiles`: pinned Provider versions and HTTP aliases, not MCP schemas.
- `internal/native`, `nativehttp`, `crypto`, `security`, `i18n`: local support code.
- `web`: independent UI package, lockfile, tests and Vite build.

Initial source extracted from Lexmount InsightFlow under the included MIT license.
Pinned Provider compatibility metadata retains upstream licenses and provenance in
`internal/profiles/{hindsight,openviking}`. Native MCP tool schemas are always fetched
from the Provider; the compatibility profiles do not introduce a platform scope.

## Verification

```sh
go test -race ./...
MEMORY_TEST_DATABASE_URL='postgres://.../memory_test?sslmode=disable' \
  go test -race -tags integration ./...
cd web
pnpm build
pnpm test
```

Integration tests require a dedicated disposable database and fail on connection or
migration errors. They skip only when the test database variable is absent.

CI runs Go build/vet, race-enabled PostgreSQL integration tests, UI tests and the
production UI build. The container uses only this repository as its build context.
