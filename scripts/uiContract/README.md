# UI semantic contract compiler

This directory owns Cherry Studio's build-time `data-ui` protocol.

- `sync.ts` scans renderer TSX/JSX and window HTML, reconciles stable IDs, and writes the committed registry.
- `vitePlugin.ts` injects readable semantic tokens and exact stable ID tokens before React compilation.
- `transform.ts` performs source-mapped AST/HTML transformations without using display text or line numbers as identity.
- `registry.ts` preserves IDs across builds and uniquely recoverable file moves; retired IDs are never reused.
- `query.ts` resolves a semantic prefix to exact IDs and source metadata for AI and developer tooling.

Run `pnpm ui:contract:sync` after changing renderer markup. CI and production builds use
`pnpm ui:contract:check` and fail when the registry has drifted.

Use `pnpm ui:contract:query chat.message` to discover the exact source nodes behind a public semantic role.

The emitted `ui-contract.json` is deterministic and maps every compiled node back to its relative source location for
theme tooling, tests, and controlled AI automation.
