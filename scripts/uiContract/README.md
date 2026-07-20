# UI semantic contract compiler

This directory owns Cherry Studio's build-time `data-ui` protocol.

- `vitePlugin.ts` injects readable semantic tokens and deterministic exact ID tokens before React compilation.
- `transform.ts` performs source-mapped AST/HTML transformations without using display text or line numbers as identity.
- `semanticId.ts` derives semantic roles, canonical source anchors, and `ui-<16 hex>` exact IDs.
- `query.ts` scans current sources and resolves a semantic prefix to exact IDs and source metadata for AI and developer
  tooling.

Intrinsic HTML elements and `svg` roots are covered automatically. SVG drawing internals are skipped unless they opt in
with `data-ui`, `data-testid`, `role`, an event handler, or a static `packages/ui` `data-slot`; HTML inside
`foreignObject` is covered normally. Reusable
component structure is expressed as `part:*` tokens inside `data-ui`. Static `data-slot` markers remain valid only in
`packages/ui/src`, where the compiler mirrors them to `part:*` while preserving the component library's private marker;
other sources must author `part:*` directly. Exact `id:*` tokens belong only to intrinsic DOM nodes. Semantic/state
tokens passed through component props are merged with the intrinsic node's parts and exact ID, including through JSX
spreads and Radix `asChild` slots.

Exact IDs are `ui-` plus the first 16 hexadecimal characters of the node's SHA-256 source-anchor hash. They are stable
for the same canonical source coordinate but intentionally change when a structural refactor changes that coordinate.
Builds and source queries reject a truncated-hash collision. There is no committed registry or synchronization step.

Use `pnpm ui:contract:query chat.message` to discover the exact source nodes behind a public semantic role.

The emitted `ui-contract.json` is deterministic and maps every compiled node back to its relative source location for
theme tooling, tests, and controlled AI automation.
