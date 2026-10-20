# AGENTS.md — Documentation

These instructions apply to `docs/**`. Read [the documentation governance workflow](../.agents/skills/docs-governance/SKILL.md) before restructuring, auditing, or authoring repository documentation.

- Put one fact in one home. Cross-cutting behavior belongs under `docs/references/`; repository process belongs under `docs/contrib/`; module-private contracts stay beside their code.
- Reference docs describe current shipped behavior. Decision history and rejected alternatives belong in [Agent Notes](../.agents/notes/README.md).
- Every reference document carries `description` and existing `sources` frontmatter. Contrib and governance documents require `description`; never hand-edit generated `docs/README.md` or `docs/sources-index.json`.
- Before changing code-linked docs, run `pnpm docs:affected --base <verified-ref>` and inspect every candidate semantically. A match is a review prompt, not proof that prose must change.
- In-scope bilingual documents update as a complete English/Chinese/sidecar triplet. Follow [the pairing contract](i18n/README.md), [translation rules](i18n/translation-rules.md), and generated [terminology](i18n/terminology.md).
- Preserve behavior, failure, timing, ownership, modality, exceptions, and consequences. Remove reasoning transcripts, implementation narration, review history, duplicated rationale, and hand-maintained inventories whose owner already exists.
- Run `pnpm docs:check` for documentation-only work. Script, hook, or skill changes also require their focused tests and `pnpm lint`.
