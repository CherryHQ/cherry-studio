# Breaking Changes Log

Release-note fragments recording changes that affect how users use the app. The v2 refactor records are preserved here for release reconciliation; new user-visible changes use the same format. See [Release Workflow](../contrib/release-workflow.md) for publication and [V2 index](./v2-index.md) for the historical index.

## When to add an entry

Add an entry when a v2 change is **user-perceivable and affects how users use the app**. Examples:

| Type | Example |
|------|---------|
| Removed | A built-in integration / page / setting is gone |
| Changed | Default model, default behavior, or interaction flow is different |
| Moved | A setting or feature is now under a different menu / location |
| Data migration | A v1 field is dropped, transformed, or no longer preserved |
| Shortcut | A keyboard shortcut, URL scheme, or CLI surface is changed |
| Platform | Minimum OS version, required external service, or network requirement is changed |

## When NOT to add an entry

Pure internal refactors with no user-visible impact. The user cannot tell these happened:

- IPC channel renamed / consolidated
- Service split, lifecycle migration, decorator changes
- Drizzle schema microchanges that round-trip identically through migration
- Internal type renames, file relocations under `src/main/services/`

If unsure, err on the side of recording — easier to drop a notice during release prep than to recover a missed change.

## File naming

`YYYY-MM-DD-<brief-kebab-case>.md`

- Date is the entry author date (when you create the file), not PR merge date — keeps naming stable across rebases and reverts
- Brief is a short kebab-case description, ≤ 6 words
- Examples: `2026-04-29-remove-bilibili-integration.md`, `2026-04-29-default-model-changed-to-gemini.md`

## Authoring

1. Copy `_template.md` to `YYYY-MM-DD-<brief>.md`
2. Fill the frontmatter and body. See "Field reference" below
3. If `What the user should do` is not yet decided, write `TBD`
4. Commit as part of the PR that introduces the change

## Field reference

| Field | Required | Meaning |
|-------|----------|---------|
| `title` | yes | Short, user-visible headline. Not a commit subject — write what the user would notice |
| `category` | yes | One of `removed`, `changed`, `moved`, `data-migration`, `shortcut`, `platform`, `other` — for grouping at release time |
| `severity` | yes | `breaking` = user must take action / will be confused; `notice` = user should know but the app keeps working |
| `introduced_in_pr` | yes | `#<PR number>`; if no PR (direct push), use the commit hash |
| `date` | yes | `YYYY-MM-DD`, when this entry was authored |
| `What changed` | yes | 1–3 sentences. Concrete user-visible behavior, not implementation |
| `Why this matters to the user` | yes | What will the user notice, when, and where |
| `What the user should do` | yes | Workaround, replacement feature, manual step, or `nothing — automatic`. `TBD` allowed |
| `Notes for release manager` | no | Caveats, edge cases, related entries to merge, screenshots to attach |

## Language

All entries are in English. The Chinese translation happens once at release time, not per entry.

## Lifecycle

```
PR introduces user-impacting change
  → author drops an .md fragment here
  → fragments accumulate during development
  → at release prep, release manager aggregates, translates, polishes
  → published as Chinese user-facing release note
  → fragments may be removed once reconciled with the published release note
```

This mirrors the `.changeset/` fragment-then-discard pattern. The fragments are not the permanent record — the published release note is.
