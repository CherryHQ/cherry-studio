# Anti-slop provenance

Source: https://github.com/dmmulroy/anti-slop

Commit: `13909c9e07590f5a85d93c62712259fe14a883f7`.

The production source is copied unchanged from `src/` through the upstream
`install-anti-slop` skill assets into `scripts/lint/anti-slop/`.
Upstream test files are not included. The root MIT license and the nested
ESLint Stylistic license and provenance are retained.

Local additions: this provenance record, a private `package.json` declaring ESM
for Node loading, and the root `LICENSE` copied from the same revision. Rule implementations have no local modifications. Selection is
owned by `.oxlintrc.json`; see [the lint contract](../README.md).

The generic entry point is registered. Effect sources are preserved but are not
registered because this repository does not declare a direct Effect dependency.
Keep `oxlint` and `@oxlint/plugins` pinned to the same exact version.

For updates, stage the incoming revision separately and compare it with this
pristine revision before merging. Preserve local rule selection and record any
source modifications here; do not overwrite the installed directory blindly.
