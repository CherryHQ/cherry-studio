# KnowledgeVectorMigrator

`KnowledgeVectorMigrator` migrates legacy per-base `embedjs` vector databases into the legacy single-table `libsql_vectorstores_embedding` layout.

> **⚠️ Transitional state (PR A → PR B).** The runtime `KnowledgeIndexStore` no longer
> reads this single-table layout — it uses the 7-table material model in the same
> `index.sqlite` file. Until this migrator is rewritten to emit that final layout
> (PR B), its output mounts as an **empty** index: the store-open path detects the
> legacy remnant and logs an error, and an integration test in
> `__tests__/KnowledgeVectorMigrator.test.ts` pins the contract. PR B is a hard
> blocker for enabling this migration for real users.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Migrated knowledge base identities and dimensions | SQLite `knowledge_base` | `knowledge_base` table |
| Migrated knowledge item identities | SQLite `knowledge_item` | `knowledge_item` table |
| Legacy loader metadata | Redux `knowledge.bases[].items[]` | `ReduxStateReader.getCategory('knowledge')` |
| Legacy chunk vectors | Per-base legacy vector DB | `ctx.sources.knowledgeVectorSource.loadBase(base.id)` |

The source reader is initialized by `MigrationContext` with `ctx.paths.knowledgeBaseDir`. It must read from the migration-resolved v1 userData path, not from the v2 path registry or `app.getPath()`. `KnowledgeVectorMigrator` itself should continue to use the reader abstraction instead of constructing vector DB paths inline.

## Target Storage

- Per-base libsql vector store at the migrated base's runtime path:
  `{knowledgeBaseDir}/{migratedBaseId}/.cherry/index.sqlite`
- Table: `libsql_vectorstores_embedding` — the legacy single-table layout, which
  the runtime store does not read (see the transitional note above)

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
   - Vectors mapped to container items, currently `directory`, are skipped with warnings.
   - This does not remove the `directory` rows from `knowledge_item`; it only prevents container-level vectors from being written into the V2 vector store.

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
   - Creates the legacy single-table layout (`external_id`, `collection`, FTS shadow tables). The runtime store does **not** read this layout; it is rewritten to the 7-table final state in PR B.
   - Migrated rows use `collection = base.id`, matching what the removed vendored store wrote.

## File-Safety Contract

- The migrator writes each rebuilt vector store to a temporary sibling of the
  target (`{targetDbPath}.vectorstore.tmp`), then renames it onto the target path.
- The v1 legacy embedjs DB (`{knowledgeBaseDir}/{legacyBaseId}`) is **never**
  moved or deleted. Each migrated base gets a new uuid, so the rebuilt V2 store
  lives under a different path (`{migratedBaseId}/.cherry/index.sqlite`) and never
  collides with the legacy flat path — the legacy source needs no relocation. A
  user who rolls back to v1 after a failed, abandoned, or even successful
  migration keeps a working knowledge base.
- Before the rename, any pre-existing target (the runtime may have auto-created an
  empty store there) is removed; that unlink retries on `EBUSY` so a transient
  Windows file lock does not abort the migration.
- Retry is naturally idempotent: the legacy source is still in place, so a retry
  re-reads the original legacy DB directly. `.embedjs.bak` is no longer written by
  this flow; `KnowledgeVectorSourceReader` keeps a read-only `.embedjs.bak`
  fallback solely for installs that already ran the previous migration (which
  renamed the original aside).

## IMPORTANT: Current Limitations

- Base-level execution failures are treated as migration failures, not as skippable data warnings. If rebuilding or replacing one base fails, `execute()` returns `success: false`.
- After a successful migration the v1 legacy vector DBs (and the copied legacy
  upload files) remain on disk as orphans; disk space is not reclaimed. Reclaiming
  it is intentionally left to a separate future cleanup step gated on the user
  abandoning v1.

## Validation

Validation checks the migrated rows inside the legacy table only — it does not
(and currently cannot) prove the runtime store can read them; see the
transitional note at the top.

- Per-base row count must equal the prepared row count.
- `external_id` must be non-empty for every migrated row.
- `metadata.itemId` must be present and match `external_id` for every migrated row.
- `metadata` must satisfy the runtime `KnowledgeChunkMetadataSchema`.

## Skipped Data

- Bases missing from migrated `knowledge_base`
- Bases marked `failed` or with `embeddingModelId = null`
- Bases whose legacy DB file is missing, resolves to a directory, or does not contain a `vectors` table
- Vector rows whose `uniqueLoaderId` cannot be mapped to a migrated `knowledge_item.id`
- Vector rows mapped to non-indexable container item types such as `directory`
- Vector rows with missing or empty `vector` payloads
- Vector rows whose `vector` payload exists but is exposed through an unsupported runtime encoding
- Vector rows whose source cannot be resolved from either the legacy row or migrated `knowledge_item.data.source`

If every legacy vector row under one base is skipped, the rebuilt V2 vector store for that base is expected to be empty. This is intentional: only vectors that can be proven to belong to migrated `knowledge_item` rows remain valid in V2.
