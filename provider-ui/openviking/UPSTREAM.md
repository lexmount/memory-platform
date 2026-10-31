# OpenViking source integration
Source: https://github.com/volcengine/OpenViking/tree/20f9c11362ad16193b0daa4a414e1095061af427/web-studio
Version: 0.5.0. License retained in LICENSE.upstream.
The official source is vendored, not recreated. Platform-specific code lives in src/platform.
Adaptations: application/user connection provider; scoped platform transport and storage;
root layout without upstream shell; shared UI exports; portal container; supported routes.
The platform imports this React library directly. There is no iframe or secondary React root.

Platform parity: native sessions (including its child route), home metrics and request logs are mounted alongside filesystem, retrieval, skills, tasks, watches, compile and agent experience. Session chat is gated by the scoped provider catalog; a missing VikingBot endpoint is explained before sending. Server-wide monitoring, root account administration and connection credentials remain outside the project workspace.

Typography: host element resets live in the base cascade layer and the legacy landing-page h1 rule is scoped to that page. Native page titles/descriptions use ov-page-title/ov-page-description; component utility classes retain control of body text, controls, spacing and secondary labels. Sessions use the platform content height rather than the native full-window shell height.
