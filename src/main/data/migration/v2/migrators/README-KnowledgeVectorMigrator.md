# KnowledgeVectorMigrator

`KnowledgeVectorMigrator` migrates legacy per-base `embedjs` vector databases into the new libsql-backed `vectorstores` layout.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Migrated knowledge base identities and dimensions | SQLite `knowledge_base` | `knowledge_base` table |
| Migrated knowledge item identities | SQLite `knowledge_item` | `knowledge_item` table |
| Legacy loader metadata | Redux `knowledge.bases[].items[]` | `ReduxStateReader.getCategory('knowledge')` |
| Legacy chunk vectors | Per-base legacy vector DB | `${getDataPath()}/KnowledgeBase/<baseId>` |

## Target Storage

- Per-base libsql vector store file at the existing knowledge DB path
- Table: `libsql_vectorstores_embedding`

## Key Transformations

1. Loader identity remapping
   - `uniqueLoaderId` is not kept as a persisted field.
   - It is resolved back to `knowledge_item.id` and written into `external_id`.
   - `uniqueIds[]` takes precedence over legacy `uniqueId`.

2. Chunk payload migration
   - `pageContent` -> `document`
   - `metadata.source` -> `metadata.source`
   - Other legacy metadata fields are dropped.

3. Embedding reuse
   - Legacy `vector` payloads are decoded from `F32_BLOB` and written directly to `embeddings`.
   - Existing chunk embeddings are reused; this migrator does not re-embed content.

4. Chunk identity regeneration
   - Legacy chunk IDs are not reused.
   - Every migrated vector row gets a new UUID v4 `id`.

5. Schema bootstrap
   - Creates `external_id`, `collection`, vector index, and FTS schema needed by `@vectorstores/libsql`.

## File-Safety Contract

- The migrator writes each rebuilt vector store to a temporary sibling file first.
- The original embedjs DB stays untouched until the temporary file has been written successfully.
- Once the temp file is ready, the migrator replaces the original DB in place.
- If the current base fails before the final replacement, the original DB remains unchanged.
- The migration flow relies on the user-completed pre-migration v1 backup; it does not keep an additional in-place rollback copy.

## Validation

- Per-base row count must equal the prepared row count.
- `external_id` must be non-empty for every migrated row.
- `metadata.source` must be present for every migrated row.

## Skipped Data

- Bases missing from migrated `knowledge_base`
- Bases whose legacy DB file is missing, resolves to a directory, or does not contain a `vectors` table
- Vector rows whose `uniqueLoaderId` cannot be mapped to a migrated `knowledge_item.id`
- Vector rows with missing or empty `vector` payloads
