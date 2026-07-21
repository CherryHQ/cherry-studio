# PromptMigrator

`PromptMigrator` migrates both v1 quick-phrase stores into the single v2 `prompt` table. Assistant ownership is intentionally discarded because v2 exposes one global prompt list.

## Data Sources

| Data | Source | Notes |
|------|--------|-------|
| Global quick phrases | Dexie `quick_phrases` | Optional table in the v1 `CherryStudio` IndexedDB database |
| Assistant quick phrases | Redux `state.assistants.assistants[].regularPhrases` | Stored inline on each assistant |
| Preset quick phrases | Redux `state.assistants.presets[].regularPhrases` | Presets share the v1 Assistant shape |
| Default assistant quick phrases | Redux `state.assistants.defaultAssistant.regularPhrases` | Separate slot that may duplicate or diverge from `assistants[0]` |

The absence of the Dexie table does not stop migration. Redux assistant phrases are still prepared and inserted.

## Field Mapping

| v1 `QuickPhrase` | v2 `prompt` |
|------------------|-------------|
| `id` | `id`; valid unique UUIDs are preserved, while missing, invalid, or conflicting IDs are regenerated |
| `title` | `title`; trimmed, empty or invalid titles become `Untitled`, and titles above the v2 limit are truncated without splitting a Unicode surrogate pair |
| `content` | `content`; variable syntax is preserved |
| `order` | Used to restore the global quick-phrase sequence before assigning `orderKey` |
| `createdAt` | `createdAt`; preserve valid date values, otherwise use `updatedAt` or the migration timestamp |
| `updatedAt` | `updatedAt`; preserve valid date values, otherwise use the normalized `createdAt` |

No assistant identifier is written to the target table.

## Ordering

The target table has one whole-table fractional order:

1. Dexie global phrases come first, sorted by descending legacy `order` to reproduce v1's canonical old-to-new sequence.
2. Redux phrases follow in source order: `assistants[]`, `presets[]`, then `defaultAssistant`.
3. Each `regularPhrases` array keeps its stored order.
4. `assignOrderKeysInSequence()` stamps the combined sequence once.

This keeps the existing global migration order stable and deterministically appends the newly preserved assistant data.

## Duplicate IDs

The v1 Redux state can contain the same assistant data in multiple slots, especially the default assistant.

- Same ID, title, and content: keep the first row and count later rows as skipped duplicates. Timestamp-only differences do not create another prompt.
- Same ID but different title or content: preserve both rows. The first row keeps the v1 ID; each later conflicting row receives a new UUID and emits a migration warning.
- Missing or non-UUID ID: preserve the phrase under a generated UUID and emit a migration warning. Repeated non-empty legacy IDs still participate in duplicate detection before regeneration.
- Different IDs: preserve both rows even when their title and content match. The migrator does not infer that separately-created user records are duplicates.

Source precedence is global Dexie phrases, `assistants[]`, `presets[]`, then `defaultAssistant`.

## Validation

A candidate is rejected as invalid when its content cannot satisfy the v2 prompt contract (for example, it is missing, empty, or exceeds the v2 limit), or when an existing `regularPhrases` container is malformed. The localized completion warning includes the first few source paths so affected entries can be located. Missing IDs, invalid IDs, titles, and timestamps are normalized instead of dropping otherwise usable content.

Identical rows that reuse an ID are skipped separately as duplicates. A non-array `regularPhrases` value counts as one invalid source container, so it contributes to both `sourceCount` and `skippedCount` instead of disappearing from the migration report.

Before insertion and again after migration, every row is checked against the shared v2 prompt field schemas. Validation reports:

- `sourceCount`: all global and assistant candidates;
- `skippedCount`: invalid candidates plus identical duplicate IDs;
- `targetCount`: rows present in `prompt` after execution.

The target count must exactly equal the number of prepared rows. The migration engine clears the target table before a run, so extra or missing rows indicate a migration error.

## Execution

The combined prompt list is inserted in batches of 100 inside one SQLite transaction. This keeps the migration atomic while staying below SQLite's bound-variable limit for arbitrarily large imported assistant or preset lists.
