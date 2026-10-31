Source: https://github.com/vectorize-io/hindsight/tree/a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5/hindsight-control-plane
Version: @vectorize-io/hindsight-control-plane 1.1.0 (npm gitHead, release tag v1.1.0).

Official views and bank-page composition are retained. The Next.js shell is replaced by Memory project/user context and scoped routing/transport. Basic controls use the common OpenViking-derived platform components. platform-bank-page.tsx adapts the upstream bank page; platform-add-document.tsx extracts its shared add-document workflow from bank-selector.tsx.

Platform differences: bank creation/deletion/cloning/aliases belong to the project/user lifecycle; bank clone/delete entries remain disabled with an explanation and aliases are replaced with the platform-managed notice. Global bank enumeration is restricted to the active user's mapped bank. Runtime feature flags are forwarded from the provider instead of inferred from operation names. API errors are normalized to text. Existing entity graph retry protection is retained.
