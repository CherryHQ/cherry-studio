# KnowledgeVectorMigrator

`KnowledgeVectorMigrator` migrates legacy per-base `embedjs` vector databases into the new libsql-backed `vectorstores` layout.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Migrated knowledge base identities and dimensions | SQLite `knowledge_base` | `knowledge_base` table |
| Migrated knowledge item identities | SQLite `knowledge_item` | `knowledge_item` table |
| Legacy loader metadata | Redux `knowledge.bases[].items[]` | `ReduxStateReader.getCategory('knowledge')` |
| Legacy chunk vectors | Per-base legacy vector DB | `ctx.sources.knowledgeVectorSource.loadBase(base.id)` |

The source reader is initialized by `MigrationContext` with `ctx.paths.knowledgeBaseDir`. It must read from the migration-resolved v1 userData path, not from the v2 path registry or `app.getPath()`. `KnowledgeVectorMigrator` itself should continue to use the reader abstraction instead of constructing vector DB paths inline.

## Target Storage

- Per-base libsql vector store file at the existing knowledge DB path
- Table: `libsql_vectorstores_embedding`

## Key Transformations

1. Loader identity remapping
   - Failed knowledge bases without a resolved embedding model are skipped at the base level; they keep their SQLite base/items and must be rebuilt after the user selects a new model.
   - `uniqueLoaderId` is not kept as a persisted field.
   - It is resolved back to `knowledge_item.id` and written into `external_id`.
   - `uniqueIds[]` takes precedence over legacy `uniqueId`.
   - A legacy vector row is considered valid only if it can be mapped to an existing V2 `knowledge_item.id`.
   - Unmapped legacy rows are treated as invalid index residue, not as business data that must be preserved.

2. Indexable item filtering
   - Only vectors mapped to indexable V2 item types are migrated.
   - Indexable types are `file`, `url`, and `note`.
   - Vectors mapped to container items, currently `directory` and `sitemap`, are skipped with warnings.
   - This does not remove the `directory` or `sitemap` rows from `knowledge_item`; it only prevents container-level vectors from being written into the V2 vector store.

3. Chunk payload migration
   - `pageContent` -> `document`
   - `knowledge_item.id` -> `metadata.itemId`
   - `knowledge_item.type` -> `metadata.itemType`
   - Legacy row `source`, falling back to `knowledge_item.data.source` -> `metadata.source`
   - Per-item migrated row order -> `metadata.chunkIndex`
   - Estimated document token count -> `metadata.tokenCount`
   - Other legacy metadata fields are dropped.

4. Embedding reuse
   - Legacy `vector` payloads are decoded from `F32_BLOB` and written directly to `embeddings`.
   - Unsupported vector encodings are skipped under `unsupported_vector_encoding`, separate from truly missing payloads.
   - Existing chunk embeddings are reused; this migrator does not re-embed content.

5. Chunk identity regeneration
   - Legacy chunk IDs are not reused.
   - Every migrated vector row gets a new UUID v4 `id`.

6. Schema bootstrap
   - Creates `external_id`, `collection`, and FTS schema needed by `@vectorstores/libsql`.
   - Migrated rows use `collection = base.id` so runtime reads and deletes match the same per-base store contract.

## File-Safety Contract

- The migrator writes each rebuilt vector store to a temporary sibling file first.
- The original embedjs DB stays untouched until the temporary file has been written successfully.
- Once the temp file is ready, the migrator moves the original embedjs DB to a
  `.embedjs.bak` sibling and places the rebuilt V2 store at the original path.
- Retry reads from the `.embedjs.bak` sibling when the original path already
  contains a V2 vector store from an earlier attempt.

## IMPORTANT: Current Limitations

- Base-level execution failures are treated as migration failures, not as skippable data warnings. If rebuilding or replacing one base fails, `execute()` returns `success: false`.
- Retry depends on the `.embedjs.bak` sibling staying beside the rewritten V2
  store until the migration flow has completed.

## Validation

- Per-base row count must equal the prepared row count.
- `external_id` must be non-empty for every migrated row.
- `metadata.itemId` must be present and match `external_id` for every migrated row.
- `metadata` must satisfy the runtime `KnowledgeChunkMetadataSchema`.

## Skipped Data

- Bases missing from migrated `knowledge_base`
- Bases marked `failed` or with `embeddingModelId = null`
- Bases whose legacy DB file is missing, resolves to a directory, or does not contain a `vectors` table
- Vector rows whose `uniqueLoaderId` cannot be mapped to a migrated `knowledge_item.id`
- Vector rows mapped to non-indexable container item types such as `directory` or `sitemap`
- Vector rows with missing or empty `vector` payloads
- Vector rows whose `vector` payload exists but is exposed through an unsupported runtime encoding
- Vector rows whose source cannot be resolved from either the legacy row or migrated `knowledge_item.data.source`

If every legacy vector row under one base is skipped, the rebuilt V2 vector store for that base is expected to be empty. This is intentional: only vectors that can be proven to belong to migrated `knowledge_item` rows remain valid in V2.
