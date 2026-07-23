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

The compiler annotates the intrinsic roots of component render branches. Once a parent component boundary exists,
ordinary nested HTML remains unmarked—including adjacent layout wrappers, paragraphs, headings, and list items. A
nested node is promoted only by an authored `data-ui`, a structural `data-slot`, a stable semantic attribute, or a
directly named business handler such as `handleCopy`. Event plumbing such as `handleClick`, `stopPropagation`, and
`preventDefault` does not create another boundary.

Inferred names use a compact `domain.component[.action.verb]` shape. Source implementation folders and raw element
names do not enter the token. Multiple roots or render branches owned by the same component may intentionally share one
token; generated ordinals and hashes are forbidden. SVG drawing internals must opt in, and HTML inside `foreignObject`
starts a new component boundary.

Existing static `data-slot` markers remain unchanged in source and output and enter the same semantic normalization rule
as authored `data-ui` `part:*` tokens. Caller semantics passed through component props are merged with the intrinsic
node's structural parts, including through JSX spreads and Radix `asChild` slots.

Use `pnpm ui:contract:query chat.message` to discover matching semantic roles and their current source locations.
