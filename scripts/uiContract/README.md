# UI semantic contract compiler

This directory owns Cherry Studio's build-time `data-ui` protocol.

- `sync.ts` scans source and updates the committed minimal identity registry.
- `vitePlugin.ts` injects readable semantic tokens and registered exact ID tokens before React compilation.
- `transform.ts` performs source-mapped AST/HTML transformations without using display text or line numbers as identity.
- `semanticId.ts` derives semantic roles, source anchors, structural fingerprints, and initial `ui-<16 hex>` IDs.
- `registry.ts` preserves IDs across unchanged anchors and unambiguous structural moves.
- `query.ts` resolves a semantic prefix to registered IDs and source metadata for AI and developer tooling.

Intrinsic HTML elements and `svg` roots are covered automatically. SVG drawing internals are skipped unless they opt in
with `data-ui`, `data-testid`, `role`, an event handler, or a static `data-slot`; HTML inside `foreignObject` is covered
normally. Reusable component structure is expressed as `part:*` tokens inside `data-ui`. Existing static `data-slot`
markers remain unchanged in source and output; the compiler mirrors them to `part:*` tokens in the public contract.
Exact `id:*` tokens belong only to intrinsic DOM nodes. Semantic/scope tokens passed through component props are merged
with the intrinsic node's parts and exact ID, including through JSX spreads and Radix `asChild` slots.

New exact IDs are `ui-` plus the first 16 hexadecimal characters of the node's SHA-256 source-anchor hash. The committed
`ui-contract.registry.json` stores only `[anchorHash, fingerprintHash, id]`; semantic roles and deleted-ID history are
not duplicated. Reconciliation preserves an ID when a same-shape occurrence cohort is unchanged, a file move is
Git-confirmed, or exactly one departed and one arrived node share a structural fingerprint. Adding or removing
indistinguishable siblings rotates that cohort's IDs instead of guessing which source node kept an occurrence anchor.

Run `pnpm ui:contract:sync` after changing renderer markup. CI and production builds use `pnpm ui:contract:check` and
reject stale registry data. Resolve registry merge conflicts by accepting either side and rerunning the sync command,
never by hand-editing the JSON.

Use `pnpm ui:contract:query chat.message` to discover the exact source nodes behind a public semantic role.

The emitted `ui-contract.json` is deterministic and maps every compiled node back to its relative source location for
theme tooling, tests, and controlled AI automation.
