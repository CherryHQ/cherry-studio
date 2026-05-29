# AssistantMigrator

The `AssistantMigrator` migrates assistants and presets from the v1 Redux state into the v2 `assistant` table (plus the `assistant_mcp_server`, `assistant_knowledge_base`, `tag`, and `entity_tag` junction tables).

## Data Sources

| Data | Source | Notes |
|------|--------|-------|
| User assistants | Redux `state.assistants.assistants[]` | Includes the v1 initial-state copy of the default assistant (id=`default`) |
| Saved presets | Redux `state.assistants.presets[]` | |
| Default assistant slot | Redux `state.assistants.defaultAssistant` | Standalone slot, id=`default` — has its own update path (`updateDefaultAssistant`) and can drift from `assistants[0]` |

### Why the v1 Slice Has Two Default Slots

The v1 slice's `initialState` seeds **both** `state.assistants.defaultAssistant` and `state.assistants[0]` from the same `getDefaultAssistant()` factory (id=`default`). Reducers then update one or the other independently:

- `updateDefaultAssistant` writes only to the slot.
- `updateAssistant` / `updateAssistantSettings` / `addTopic` write only to `assistants[]`.

In practice, real users typically have **both** slots populated with overlapping but non-equivalent data on id=`default`. The migrator must look at both and reconcile them, otherwise customizations on whichever slot wasn't picked are silently lost.

## Same-id Merge Strategy

When two sources carry the same id, `mergeOldAssistants(primary, secondary)` produces a single merged assistant. **Duplicates are NOT skipped.**

Push order is `assistants[]` → `presets[]` → `defaultAssistant`, so `assistants[0]` is the **primary** in the common id=`default` collision (it gets the live edits from the assistants page), and `defaultAssistant` only fills in fields the live copy left empty.

### "Non-empty" Rules

A field on `primary` "wins" only when it is **present**. Otherwise `secondary`'s value is used.

| Type | Treated as empty (falls through to `secondary`) |
|------|--------------------------------------------------|
| `string` | `undefined`, `null`, `''` |
| Array | `undefined`, `null`, `[]` |
| Plain object | `undefined`, `null`, `{}` (e.g. default-seeded `defaultModel: {}`) |
| Boolean | `undefined`, `null` only — `false` is a real choice |
| Object (settings root) | `undefined`, `null` (the settings root itself; nested keys follow the same rules) |

The empty-array rule prevents a default-empty `mcpServers: []` on `assistants[0]` from clobbering a populated `mcpServers: [s1]` on `defaultAssistant`.

### Settings Shallow Merge

`primary.settings` and `secondary.settings` are shallow-merged per key with the same "non-empty wins" rule. Nested objects (e.g. `defaultModel`, `customParameters`) are not deep-merged — the first-non-empty top-level reference wins.

### Unenumerated Fields

The merged object is built as `{ ...secondary, ...primary, /* explicit overrides */ }`, so any field not listed in `OldAssistant` (e.g. fields from older v1 versions) survives the merge: `secondary` provides a baseline, `primary` overrides on overlap.

## Data Quality Handling

| Issue | Detection | Handling |
|-------|-----------|----------|
| Missing/invalid id | `!id` or `typeof id !== 'string'` | Skip source, log warning |
| Same id across sources | `sourceById.has(id)` | Merge field-by-field (see above); silent at info-log level — v1's initialState seeds id='default' in both `assistants[0]` and `defaultAssistant`, so this fires on essentially every real-user migration |
| Legacy id `'default'` | `id === LEGACY_DEFAULT_ASSISTANT_ID` | Remap to a fresh UUID before merge / insert (see "Legacy default-assistant remap" below) |
| Transform failure | `transformAssistant()` throws | Skip merged source, log warning |
| All sources skipped | `totalRawSources > 0 && skippedCount > 0 && preparedResults.length === 0` | Fail prepare phase |
| Dangling `model` ref | `userModelTable` lookup miss | Drop `modelId` (set to null), log warning |
| Dangling MCP server ref | `mcpServerIdMapping` lookup miss | Drop the junction row, log warning |
| Missing `mcpServerIdMapping` while assistants reference MCP servers | `sharedData.get('mcpServerIdMapping') === undefined` | Throw — `McpServerMigrator` must run before this one |

## Legacy default-assistant remap

v2 has **no system-reserved `'default'` assistant row**. The renderer composes a runtime default from `Preference.defaultModelId` (and other UI-level defaults), so `assistant` is empty for new installs and contains only user-created/migrated rows for upgraders.

To preserve user customizations made to v1's default assistant, `recordSource()` rewrites the legacy literal `'default'` to a freshly generated UUID before inserting into `sourceById`. Both v1 sources for that id (`assistants[0]` and the standalone `defaultAssistant` slot) collide on the same UUID and merge under the standard primary-wins contract. The remap (`'default' → UUID`) is held on the migrator instance for the duration of `prepare`/`execute` and exposed through `ctx.sharedData` so `ChatMigrator` can rewrite any `topic.assistantId === 'default'` to the same UUID rather than orphaning the topic.

If v1 had no `'default'` source at all (no `assistants[0]/defaultAssistant`), no remap entry is created and any topic that referenced the legacy literal becomes a true orphan in `ChatMigrator` — written as `assistantId = NULL`.

## Downstream Hand-off

`AssistantMigrator.execute()` writes two entries to `ctx.sharedData`:

- `'assistantIds'` — `Set<string>` of migrated assistant IDs (FK whitelist for `ChatMigrator`). Contains exactly the `assistant.id` values inserted into the table; v2 has no synthetic 'default' so the literal is absent.
- `'legacyAssistantIdRemap'` — `Map<string, string>` of v1 → v2 id rewrites. Currently only used for `'default' → UUID` (see above), but the map shape is generic for future legacy-id translations.

`ChatMigrator.prepare()` and `prepareTopicData()` consume both: the remap rewrites `topic.assistantId` references, then the FK whitelist validates the result.

## Implementation Files

- `AssistantMigrator.ts` - Main migrator class (prepare / execute / validate)
- `mappings/AssistantMappings.ts` - Pure transform functions and `OldAssistant` type
