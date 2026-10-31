# Native UI integration

The host imports vendored provider React views directly (no iframe). OpenViking
0.5.0 provides the shared Base UI controls and Tailwind theme. Hindsight 1.1.0
uses compatibility wrappers around those same controls; its business views
remain upstream source. See each UPSTREAM.md and LICENSE.upstream.

Install and build:

    npm --prefix provider-ui/openviking ci
    pnpm --dir web install --frozen-lockfile
    pnpm --dir web build

`src/platform` in the OpenViking package supplies the host bridge, provider-scoped
identity, route adapters, portal container and Hindsight Next.js client adapters.
All business calls use the existing authenticated application/User bridge. Server
credentials and provider account selection are not exposed to these views.

Integrated OpenViking views: filesystem, retrieval, skills, tasks, watches,
agent experience, compile, home and request logs (where exposed by the host).
Integrated Hindsight views: memories, documents, entities, mental models,
knowledge pages and recall/reflect. Hindsight older-version compatibility and
advanced management, plus OpenViking sessions/advanced operations, retain host
views. The original standalone provider shells and bank/account management
are intentionally not mounted. Platform-native management controls remain
available through the existing application and native-operation pages.

Validation covers host TypeScript, scoped transport and bounded HTTP 503 handling, production builds, and live provider reads.
