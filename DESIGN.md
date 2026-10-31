# Memory console

The console is organized around projects. A project and the previously named application are the same entity; there is no user-facing space/application hierarchy. Each project selects one memory engine and owns its API credentials and users.

## Navigation and onboarding

The header next to Memory displays the selected project name. Its popover lists projects and Create project. The persistent, collapsible 256px sidebar contains the user selector and provider views, with Project information above API integration at the bottom. Account actions live in the header avatar menu. Project inventory is not repeated in the sidebar. The navigation reference is InsightFlow developer-dev / Managed Agents (lex-dev a4b89756).

After login, users land on the project directory. Empty accounts stay empty until the user creates a project. New project creation defaults to Hindsight and allows selecting OpenViking. Existing projects are preserved. The internal workspace schema remains compatible but is not exposed as a second navigation layer.

Selecting a project clears the previous user context. Provider navigation appears within the selected user. Account API keys remain separate from project credentials. Each project provisions the reserved `default` user (shown as 默认用户). Other users are created only through external integration. Credentials appear once after explicit creation or rotation.

## Native provider views

Reuse the vendored OpenViking 0.5.0 and Hindsight 1.1.0 React views described in provider-ui/README.md and their UPSTREAM.md files. OpenViking supplies shared controls and theme; Hindsight uses compatibility wrappers. The host supplies project/user-scoped transport and navigation without an iframe or a second React root. Upstream account and bank administration shells are not mounted.

Keep loading, empty, error/retry, pagination, disabled/revoked credentials and unconfirmed writes distinct. Never invent provider metadata. Requests must remain scoped to the selected project/user, and late responses must not overwrite a new selection. HTTP 503 must not trigger infinite retries.

## Presentation and verification

Use the light neutral palette, compact icon/text navigation, clear active states and system Chinese fonts. Mobile navigation uses a modal drawer. Preserve URL-backed user context and filters, and remembered sidebar collapse state. No decorative media or animations.

Validate both languages, project switching and cancellation, first-project concurrency, schema migration preservation, native transport isolation, production builds, and live browser behavior.

Project selector width is fixed (125px desktop and mobile). Truncated names expose the full name on hover. Each row reveals an ellipsis action on hover or keyboard focus (always visible for touch), offering Rename and Delete. Delete requires confirmation, revokes access and retains native data; deleting the last project does not trigger onboarding again.

Project settings navigation and page are removed; legacy app-settings URLs redirect to the project overview. Rename and delete remain in the project selector.

Sidebar collapse control follows InsightFlow developer-frontend Shell: a 13×42px neutral pill centered vertically on the sidebar boundary, with 12px directional chevrons. The expanded/collapsed sidebar width controls its horizontal position. Mobile retains drawer navigation.

The Memory home route now opens the project directory as a first-level entry. Projects appear in a searchable, engine-filterable table inside the shared white card / gray canvas style. Select a project to enter its existing sidebar workspace. Create project opens the creation form, which returns to the directory via its back link.

The persistent user selector sits above the provider navigation and defaults to `default`. Both providers display the same user vocabulary; Hindsight maps each project/user to its own bank. Provider navigation is available immediately; switching users preserves the functional page and clears user-specific query state. The redundant bottom Users and memories navigation is removed. Existing projects receive a background, idempotent default-user backfill on startup; failures retry when their user list/default identity is opened.

Hindsight parity follows the released 1.1.0 control-plane source (npm gitHead a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5), including Home, Data, Knowledge, Recall, Reflect, Documents, Entities and Profile. Preserve its nested tabs, forms and query parameters while using platform controls and theme. Runtime feature flags come from the provider version endpoint. Bank clone/delete/alias administration remains platform-managed to preserve project/user isolation.
