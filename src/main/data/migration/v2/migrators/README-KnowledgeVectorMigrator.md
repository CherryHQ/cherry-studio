# KnowledgeVectorMigrator

`KnowledgeVectorMigrator` migrates legacy per-base `embedjs` vector databases into the new libsql-backed `vectorstores` layout.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Migrated knowledge base identities and dimensions | SQLite `knowledge_base` | `knowledge_base` table |
| Migrated knowledge item identities | SQLite `knowledge_item` | `knowledge_item` table |
| Legacy loader metadata | Redux `knowledge.bases[].items[]` | `ReduxStateReader.getCategory('knowledge')` |
| Legacy chunk vectors | Per-base legacy vector DB | `ctx.sources.knowledgeVectorSource.loadBase(base.id)` |

The current source reader resolves the per-base DB path through `application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))`. `KnowledgeVectorMigrator` itself should continue to use the reader abstraction instead of constructing vector DB paths inline.

## Target Storage

- Per-base libsql vector store file at the existing knowledge DB path
- Table: `libsql_vectorstores_embedding`

## Key Transformations

1. Loader identity remapping
   - `uniqueLoaderId` is not kept as a persisted field.
   - It is resolved back to `knowledge_item.id` and written into `external_id`.
   - `uniqueIds[]` takes precedence over legacy `uniqueId`.
   - A legacy vector row is considered valid only if it can be mapped to an existing V2 `knowledge_item.id`.
   - Unmapped legacy rows are treated as invalid index residue, not as business data that must be preserved.

2. Chunk payload migration
   - `pageContent` -> `document`
   - `knowledge_item.id` -> `metadata.itemId`
   - `knowledge_item.type` -> `metadata.itemType`
   - Legacy row `source`, falling back to `knowledge_item.data.source` -> `metadata.source`
   - Per-item migrated row order -> `metadata.chunkIndex`
   - Estimated document token count -> `metadata.tokenCount`
   - Other legacy metadata fields are dropped.

3. Embedding reuse
   - Legacy `vector` payloads are decoded from `F32_BLOB` and written directly to `embeddings`.
   - Existing chunk embeddings are reused; this migrator does not re-embed content.

4. Chunk identity regeneration
   - Legacy chunk IDs are not reused.
   - Every migrated vector row gets a new UUID v4 `id`.

5. Schema bootstrap
   - Creates `external_id`, `collection`, and FTS schema needed by `@vectorstores/libsql`.
   - Migrated rows use `collection = base.id` so runtime reads and deletes match the same per-base store contract.

## File-Safety Contract

- The migrator writes each rebuilt vector store to a temporary sibling file first.
- The original embedjs DB stays untouched until the temporary file has been written successfully.
- Once the temp file is ready, the migrator replaces the original DB in place.
- The migration flow relies on the user-completed pre-migration v1 backup; it does not keep an additional in-place rollback copy.

## IMPORTANT: Current Limitations

- Base-level execution failures are treated as migration failures, not as skippable data warnings. If rebuilding or replacing one base fails, `execute()` returns `success: false`.
- The current implementation does **not** preserve a retryable in-place copy of the original embedjs DB. It does not keep `.bak` files or other retry artifacts beside the knowledge DB path.
- Because the replacement is in-place, a failure that happens after the original DB has been removed but before the new file is fully placed may leave the base without a usable legacy source file on disk.
- Therefore, retry semantics currently depend on the user restoring the pre-migration v1 backup before running migration again. The migrator itself does not guarantee that a failed run leaves the knowledge vector source in a reusable retry state.
- This limitation is intentional for the current implementation, but it is **important** and may need follow-up design discussion or future changes if the project later wants first-class retry support without requiring manual restore.

## Validation

- Per-base row count must equal the prepared row count.
- `external_id` must be non-empty for every migrated row.
- `metadata.itemId` must be present and match `external_id` for every migrated row.
- `metadata` must satisfy the runtime `KnowledgeChunkMetadataSchema`.

## Runtime Compatibility Caveat

The current migrator intentionally allows rows without `metadata.source` when the legacy row source is empty. Current runtime search/chunk mapping validates vector metadata with `KnowledgeChunkMetadataSchema`, which requires `source`. If migrated legacy data can contain empty `source`, the runtime compatibility decision needs to be resolved in code: either make migrated metadata always include a non-empty fallback `source`, or relax the runtime schema for migrated rows. Until that is decided, this README documents the migrator's implemented behavior, not a guarantee that every migrated row is runtime-readable.

## Skipped Data

- Bases missing from migrated `knowledge_base`
- Bases whose legacy DB file is missing, resolves to a directory, or does not contain a `vectors` table
- Vector rows whose `uniqueLoaderId` cannot be mapped to a migrated `knowledge_item.id`
- Vector rows with missing or empty `vector` payloads
- Vector rows whose source cannot be resolved from either the legacy row or migrated `knowledge_item.data.source`

If every legacy vector row under one base is skipped, the rebuilt V2 vector store for that base is expected to be empty. This is intentional: only vectors that can be proven to belong to migrated `knowledge_item` rows remain valid in V2.
