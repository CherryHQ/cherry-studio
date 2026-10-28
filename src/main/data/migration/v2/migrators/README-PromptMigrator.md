# PromptMigrator

`PromptMigrator` migrates both v1 quick-phrase stores into the v2 `prompt` table. Dexie quick phrases retain global availability, while every phrase stored on an assistant becomes an independent restricted prompt with a `prompt_binding` row. This preserves v1 ownership: identical-looking phrases from different Assistants do not become shared records during migration.

## Data Sources

| Data | Source | Notes |
|------|--------|-------|
| Global quick phrases | Dexie `quick_phrases` | Creates prompts with `visibility = global`; optional table in the v1 `CherryStudio` IndexedDB database |
| Assistant quick phrases | Redux `state.assistants.assistants[].regularPhrases` | Creates prompts with `visibility = restricted` plus bindings to the migrated assistant |
| Preset quick phrases | Redux `state.assistants.presets[].regularPhrases` | Presets share the v1 Assistant shape and are migrated as assistants |
| Default assistant quick phrases | Redux `state.assistants.defaultAssistant.regularPhrases` | Uses AssistantMigrator's remapped ID; fills the phrase source only when an earlier slot for the same Assistant has no populated phrase array |

The absence of the Dexie table does not stop migration. Redux assistant phrases are still prepared and inserted.

## Field Mapping

| v1 `QuickPhrase` | v2 `prompt` |
|------------------|-------------|
| `id` | `id`; valid unique UUIDs are preserved, while missing, invalid, or conflicting IDs are regenerated |
| `title` | `title`; trimmed, empty or invalid titles become `Untitled`, and titles above the v2 limit are truncated without splitting a Unicode surrogate pair |
| `content` | `content`; variable syntax is preserved |
| source location | `visibility`; Dexie rows become `global`, Assistant rows become `restricted` |
| `order` | Used to restore the global quick-phrase sequence before assigning `orderKey` |
| `createdAt` | `createdAt`; preserve valid date values, otherwise use `updatedAt` or the migration timestamp |
| `updatedAt` | `updatedAt`; preserve valid date values, otherwise use the normalized `createdAt` |

Assistant identifiers never enter the `prompt` row. They are normalized through AssistantMigrator's `legacyAssistantIdRemap`, checked against its migrated Assistant ID set, and written to `prompt_binding`. A restricted phrase whose source Assistant was skipped remains visible in global management without being exposed to unrelated Assistants.

## Ordering

The prompt catalog and each binding target have independent fractional order:

1. Dexie global phrases come first, sorted by descending legacy `order` to reproduce v1's canonical old-to-new sequence.
2. Redux phrases follow in source order: `assistants[]`, `presets[]`, then `defaultAssistant`.
3. Each `regularPhrases` array keeps its stored order in that Assistant's `prompt_binding.orderKey` sequence.
4. `assignOrderKeysInSequence()` stamps the prompt catalog; `assignOrderKeysByScope()` stamps bindings independently for every Assistant.

The v1 initial state may store the same logical Assistant in both `assistants[]` and `defaultAssistant`. Those slots are resolved with the same precedence as AssistantMigrator: the first populated `regularPhrases` array wins, while an empty or missing primary array allows the secondary slot to fill it. This prevents duplicate phrases for one Assistant without merging phrases across different Assistants.

Contextual queries use binding order for restricted prompts, followed by global prompt order. This reproduces v1's Assistant-local-first behavior without coupling the same shared Prompt's position across contexts.

## Duplicate IDs

After same-Assistant source slots are resolved, the v1 Redux state can still contain the same phrase ID in different stores or different Assistants. Those occurrences had independent ownership in v1, so migration never infers sharing from equal IDs or content.

- Every valid source occurrence becomes one Prompt row.
- The first valid occurrence of a UUID keeps it; later occurrences with that ID receive new UUIDs, regardless of whether their content matches.
- Missing or non-UUID IDs are regenerated.
- Equal content under different IDs remains independent.

Source precedence is global Dexie phrases, `assistants[]`, `presets[]`, then `defaultAssistant`.

## Validation

A candidate is rejected as invalid when its content cannot satisfy the v2 prompt contract (for example, it is missing, empty, or exceeds the v2 limit), or when an existing `regularPhrases` container is malformed. Missing IDs, invalid IDs, titles, and timestamps are normalized instead of dropping otherwise usable content.

A non-array `regularPhrases` value counts as one invalid source container, so it contributes to both `sourceCount` and `skippedCount` instead of disappearing from the migration report.

Before insertion and again after migration, every row is checked against the shared v2 prompt field schemas. Validation also requires the inserted binding count to match the prepared relation set. Validation reports:

- `sourceCount`: all global and assistant candidates;
- `skippedCount`: invalid candidates;
- `targetCount`: rows present in `prompt` after execution.

The target count must exactly equal the number of prepared rows. The migration engine clears the target table before a run, so extra or missing rows indicate a migration error.

## Execution

The combined prompt list and its Assistant bindings are inserted in batches of 100 inside one SQLite transaction. This keeps the migration atomic while staying below SQLite's bound-variable limit for arbitrarily large imported assistant or preset lists.
