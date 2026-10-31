# Memory console

The console is organized around projects. A project and the previously named application are the same entity; there is no user-facing space/application hierarchy. Each project selects one memory engine and owns its API credentials and users.

## Navigation and onboarding

The header next to Memory displays the selected project name. Its popover lists projects and Create project. The persistent, collapsible 256px sidebar contains overview, API integration, users and memories, project settings, and account settings. Project inventory is not repeated in the sidebar. The navigation reference is InsightFlow developer-dev / Managed Agents (lex-dev a4b89756).

An account with no projects receives one project named 默认项目空间 using Hindsight. Initialization is idempotent; existing projects and their engines are preserved. New project creation defaults to Hindsight and allows selecting OpenViking. The previous internal workspace schema remains compatible with existing deployed data but is not exposed as a second navigation layer.

Selecting a project clears the previous user context. Provider navigation appears within the selected user. Account API keys remain separate from project credentials. Never auto-create users. Credentials appear once after explicit creation or rotation; onboarding projects use the existing credential rotation flow to issue a secret.

## Native provider views

Reuse the vendored OpenViking 0.5.0 and Hindsight 1.1.0 React views described in provider-ui/README.md and their UPSTREAM.md files. OpenViking supplies shared controls and theme; Hindsight uses compatibility wrappers. The host supplies project/user-scoped transport and navigation without an iframe or a second React root. Upstream account and bank administration shells are not mounted.

Keep loading, empty, error/retry, pagination, disabled/revoked credentials and unconfirmed writes distinct. Never invent provider metadata. Requests must remain scoped to the selected project/user, and late responses must not overwrite a new selection. HTTP 503 must not trigger infinite retries.

## Presentation and verification

Use the light neutral palette, compact icon/text navigation, clear active states and system Chinese fonts. Mobile navigation uses a modal drawer. Preserve URL-backed user context and filters, and remembered sidebar collapse state. No decorative media or animations.

Validate both languages, project switching and cancellation, first-project concurrency, schema migration preservation, native transport isolation, production builds, and live browser behavior.

Project selector width is fixed (250px desktop, 145px mobile). Truncated names expose the full name on hover. Each row reveals an ellipsis action on hover or keyboard focus (always visible for touch), offering Rename and Delete. Delete requires confirmation, revokes access and retains native data; deleting the last project does not trigger onboarding again.
