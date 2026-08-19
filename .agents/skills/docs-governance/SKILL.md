---
name: docs-governance
description: Use when writing, restructuring, auditing, or reviewing Cherry Studio repository documentation, READMEs, JSDoc, comments, Agent instructions, or paired English/Chinese docs, including source-linked documentation impact checks.
---

# Documentation Governance

Require an explicit scope. Read the applicable `AGENTS.md`, then the owning source or module README before judging prose.

## Place the fact

- Cross-cutting and multi-module behavior belongs under `docs/references/<domain>/`.
- Repository process belongs under `docs/contrib/`.
- Module-private behavior belongs beside the module.
- Durable rationale and rejected alternatives belong in Agent Notes.
- Standing agent orders belong in the narrowest applicable `AGENTS.md` and link their rationale.

Keep one home per fact. A domain README owns its subject and summarizes children with links; it does not copy their implementation detail. A tutorial leads through ordered actions to an observable result. A reference supports lookup and states current behavior.

## Inspect code impact

Run `pnpm change:scope --base <verified-ref>` and `pnpm docs:affected --base <verified-ref>`. Inspect every returned document against the changed behavior. A source-prefix match is a mandatory review prompt, not proof that prose needs a diff.

Reference docs describe current reality. Preserve behavior, failure, timing, ownership, modality, exceptions, and consequences. Remove implementation narration, reasoning transcripts, review history, duplicated rationale, status inventories, and catalogs whose source or generator already owns them.

## Generated and paired docs

Reference docs carry `description` and `sources`; contrib and governance docs carry `description`. Never hand-edit `docs/README.md`, `docs/sources-index.json`, or `docs/i18n/terminology.md`.

For an in-scope pair, read [the pairing contract](../../../docs/i18n/README.md), [translation rules](../../../docs/i18n/translation-rules.md), and [terminology](../../../docs/i18n/terminology.md). Update the counterpart minimally and re-record only after semantic review. Use `translate-docs` for new pairs or batch translation.

## Validation

Documentation-only work runs `pnpm docs:check`. Script, hook, code-comment, or skill changes also run focused tests, `pnpm lint`, `pnpm test:lint`, and `git diff --check` as applicable.
