# Upstream: `@a2ui/web_core`

`@prometheus-ags/a2ui-core` vendors [`@a2ui/web_core`](https://www.npmjs.com/package/@a2ui/web_core)
from npm — the core rendering / state-management library of the
[A2UI project](https://a2ui.org/) (Agent-to-User Interface), published by
Google (`a2ui-team <a2ui-owners@google.com>`, org repo
[`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui), directory
`renderers/web_core`).

## Pinned version

| Field | Value |
|---|---|
| Package | `@a2ui/web_core` |
| Workspace wrapper version | **0.10.4** |
| Pinned upstream dependency | **0.10.6** (exact, no semver range) |
| License | Apache-2.0 |
| Repository evidence | `package.json` exact dependency plus `frontend/pnpm-lock.yaml` integrity |

The pin is enforced in `package.json`'s `dependencies` field with an exact
version string (`"0.10.6"`, not `"^0.10.6"`), so `pnpm install` will not
silently drift to a newer upstream release. `pnpm-lock.yaml` additionally
locks the resolved integrity hash.

## Why a dependency pin instead of a source copy

`@a2ui/web_core` ships **compiled JS + `.d.ts`** on npm, not its original
TypeScript source — the actual TypeScript lives in the upstream monorepo
(`a2ui-project/a2ui`, `renderers/web_core/`), which is a separate,
independently-versioned project with its own build tooling. Copying the
npm tarball's compiled output into this repo would mean vendoring build
artifacts we cannot usefully edit, and would make every upstream bump a
manual artifact-diff exercise instead of a `pnpm update` review.

The first-party React renderer, inspector, and Lit/Svelte conformance renderers
build **on top of** `@a2ui/web_core`'s public API (message processing,
data/component/surface models, and catalog types) rather than modifying its
internals. If a future change must patch upstream behavior, that change must
explicitly choose and document a maintained fork or source vendor instead of
silently editing dependency output.

## How to update the pin

1. Check the current published version and changelog:
   ```bash
   npm view @a2ui/web_core versions --json
   npm view @a2ui/web_core dist-tags
   ```
   or read `CHANGELOG.md` in the published tarball
   (`npm pack @a2ui/web_core@<version>` then inspect).
2. Review the upstream `renderers/web_core/CHANGELOG.md` for breaking
   changes to the exported surfaces this package re-exports
   (`.`, `./v0_8`, `./v0_9`, `./v0_9/basic_catalog`).
3. Bump the **exact** version string in
   `frontend/packages/a2ui-core/package.json` `dependencies["@a2ui/web_core"]`.
4. Update the table above and retain the new lockfile integrity.
5. Run the root frozen install to regenerate `frontend/pnpm-lock.yaml`, then
   run the local typecheck for `@prometheus-ags/a2ui-core`.
6. Run the first-party renderer, inspector, and Lit/Svelte conformance checks
   locally after their unit is complete. GitHub Actions are deployment-only.

## License

Apache-2.0, © Google LLC. The full license text is preserved unmodified
in [`./LICENSE`](./LICENSE) (copied verbatim from the upstream package),
and every upstream source file this package re-exports retains its
original `Copyright 2025 Google LLC` / Apache-2.0 header inside
`node_modules/@a2ui/web_core` — this package does not touch or strip
those files.
