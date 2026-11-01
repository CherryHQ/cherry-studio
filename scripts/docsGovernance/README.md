# Documentation Governance Scripts

This directory owns the repository tooling for documentation structure, generated indexes, source-impact discovery, bilingual pairing, and Agent Note validation.

Use the stable `package.json` commands (`pnpm docs:*`, `pnpm change:scope`, and `pnpm agent-notes:check-transition`) rather than invoking file paths from contributor workflows. Tests are colocated under `__tests__/` and run through `pnpm test:scripts <test-file>`.

Generated files have one owner:

- `gen-doc-index.ts` writes `docs/README.md` and `docs/sources-index.json`.
- `gen-doc-terminology.ts` writes `docs/i18n/terminology.md` from `scripts/i18n-glossary.json`.

Do not hand-edit those generated outputs.
