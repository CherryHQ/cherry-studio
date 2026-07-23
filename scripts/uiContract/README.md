# UI semantic contract compiler

This directory owns Cherry Studio's build-time `data-ui` protocol.

- `vitePlugin.ts` injects readable semantic tokens before React compilation.
- `transform.ts` performs source-mapped AST/HTML transformations without using display text or line numbers.
- `semanticId.ts` derives best-effort roles from source domain, component name, element role, and stable attributes.
- `scan.ts` discovers semantic boundaries in current renderer and `packages/ui` source.
- `query.ts` resolves a semantic prefix to source metadata for developers and AI tooling.
- `runtime.ts` composes caller-owned semantics with implementation-owned structural parts.

The protocol contains static semantic roles and structural `part:*` tokens. There is no runtime entity/window identity,
exact-node `id:*` namespace, or persistent identity registry.

Intrinsic component roots, semantic HTML, and nodes with explicit semantic signals enter the contract. Nested `div` and
`span` wrappers without `data-ui`, `data-slot`, stable semantic attributes, or handlers remain unmarked. SVG roots are
covered automatically; drawing internals must opt in. HTML inside `foreignObject` starts a new semantic boundary.

Existing static `data-slot` markers remain unchanged in source and output and enter the same semantic normalization rule
as authored `data-ui` `part:*` tokens. Caller semantics passed through component props are merged with the intrinsic
node's structural parts, including through JSX spreads and Radix `asChild` slots.

Use `pnpm ui:contract:query chat.message` to discover matching semantic roles and their current source locations.
