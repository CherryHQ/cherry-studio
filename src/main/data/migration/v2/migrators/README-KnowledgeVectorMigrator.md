# KnowledgeVectorMigrator

`KnowledgeVectorMigrator` migrates legacy per-base `embedjs` vector databases into the new per-base 7-table `index.sqlite` store (`KnowledgeIndexStore`).

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Migrated knowledge base identities and dimensions | SQLite `knowledge_base` | `knowledge_base` table |
| Migrated knowledge item identities | SQLite `knowledge_item` | `knowledge_item` table |
| Legacy loader metadata | Redux `knowledge.bases[].items[]` | `ReduxStateReader.getCategory('knowledge')` |
| Legacy chunk vectors | Per-base legacy vector DB | `ctx.sources.knowledgeVectorSource.loadBase(base.id)` |

The source reader is initialized by `MigrationContext` with `ctx.paths.knowledgeBaseDir`. It must read from the migration-resolved v1 userData path, not from the v2 path registry or `app.getPath()`. `KnowledgeVectorMigrator` itself should continue to use the reader abstraction instead of constructing vector DB paths inline.

## Target Storage

- Per-base 7-table index store at the migrated base's runtime path:
  `{knowledgeBaseDir}/{migratedBaseId}/.cherry/index.sqlite`
- Built through the exact runtime open sequence — `openLibsqlIndexDriver` →
  `createKnowledgeIndexSchema` → `ensureIndexMeta` → `KnowledgeIndexStore.rebuildMaterial` —
  so the migrated store is byte-for-byte one the runtime would produce. One `material`
  per migrated item; its legacy chunks become that material's `search_unit`s.

## Key Transformations

1. Loader identity remapping
   - Failed knowledge bases without a resolved embedding model are skipped at the base level; they keep their SQLite base/items and must be rebuilt after the user selects a new model.
   - `uniqueLoaderId` is not kept as a persisted field; it is resolved back to the migrated `knowledge_item` (the `material_id`).
   - `uniqueIds[]` takes precedence over legacy `uniqueId`.
   - A legacy vector row is considered valid only if it can be mapped to an existing V2 `knowledge_item.id`.
   - Unmapped legacy rows are treated as invalid index residue, not as business data that must be preserved.

2. Indexable item filtering
   - Only vectors mapped to indexable V2 item types are migrated.
   - Indexable types are `file`, `url`, and `note`.
   - A v1-indexed `directory`'s container-level vectors are normally **re-attributed** to synthesized per-file children (one `file` child per embedded loader id; see `KnowledgeMigrator.expandLegacyDirectoryItem`), so the folder stays searchable with no re-embedding.
   - Container-level vectors are skipped with warnings only as a **fallback** — when the legacy vector sources are unreadable, or an embedded file has no migratable vectors — and the folder is then kept as a migration-failed (`directory_not_migrated`) tombstone.
   - This does not remove the `directory` rows from `knowledge_item`; it only prevents container-level vectors from being written into the V2 store.

3. Material assembly (Route A — preserve the v1 split)
   - One `material` per migrated item; its `relative_path` is derived from the migrated
     `knowledge_item` via the shared `toMaterialRelativePath` helper, identical to the runtime
     indexing job — a file uses its stored `relativePath` (the processed-artifact path when
     present). A migrated url is pinned instead to the snapshot file materialized for it under
     `raw/` (frontmatter-stamped from `content.text`), replacing the item-id virtual path the
     helper would otherwise return. The store fills the rest of the row (`current_content_hash`,
     timestamps); there is no `origin` / `index_policy` / `file_ext` column and `content` carries
     no `text_format`.
   - The item's legacy chunk bodies are concatenated (in legacy read order) into one
     canonical `content.text` joined by the document separator (`\n\n`); each chunk becomes
     a `search_unit` whose `[char_start, char_end)` slices that text back to its exact body,
     plus a body `search_text` row. `unit_index` is the per-item read order.
   - This is a synthetic concatenation, not a fresh re-split: the first real reindex
     re-chunks with the live splitter and converges. The migration is logged per base.

4. Embedding reuse (no re-embedding)
   - Legacy `vector` payloads are decoded from `F32_BLOB` to `number[]` and written through
     `encodeVectorBlob` (raw little-endian float32) into the `embedding` table, keyed by the
     body's `embedding_text_hash`. The bytes are identical to the runtime encoding, so no
     re-embedding happens and the store is engine-portable.
   - Identical chunk bodies (within or across materials) collapse to one `embedding` row.
   - Unsupported vector encodings are skipped under `unsupported_vector_encoding`, separate from truly missing payloads.
   - A vector whose length disagrees with the base's recorded `dimensions` is skipped under `dimension_mismatch` rather than corrupting the brute-force cosine scan for the whole base.

5. Identity regeneration
   - Legacy chunk row IDs are not reused; `unit_id` / `content_hash` / `search_text_id` are
     derived deterministically by the store from the material id, content and offsets.

6. Identity stamp
   - `ensureIndexMeta` writes the single `meta` identity row (schema version + base id) so the
     runtime opens the store without re-bootstrapping and rejects a swapped/foreign
     `index.sqlite` on a `base_id` mismatch. Build-contract snapshots (embedding model,
     dimensions, chunker config hash) are intentionally not stored — a model/dimension change
     creates a new base and a chunker change rebuilds the derived index.

## File-Safety Contract

- The migrator writes each rebuilt store to a temporary sibling of the target
  (`{targetDbPath}.vectorstore.tmp`), then renames it onto the target path.
- Before renaming, the WAL is folded into the main db file via
  `PRAGMA wal_checkpoint(TRUNCATE)`: only the main file is renamed, and libsql does
  not reliably checkpoint on close, so without this the renamed store would read
  short (`SQLITE_IOERR_SHORT_READ`) with its committed pages stranded in the
  orphaned `-wal` sidecar. The store's `index.sqlite{,-wal,-shm}` family is removed
  (with EBUSY-survivable retries) on both temp and target before (re)creation.
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
  re-reads the original legacy DB directly via `KnowledgeVectorSourceReader`.

## IMPORTANT: Current Limitations

- Base-level execution failures are treated as migration failures, not as skippable data warnings. If rebuilding or replacing one base fails, `execute()` returns `success: false`.
- After a successful migration the v1 legacy vector DBs (and the copied legacy
  upload files) remain on disk as orphans; disk space is not reclaimed. Reclaiming
  it is intentionally left to a separate future cleanup step gated on the user
  abandoning v1.

## Validation

Per successful base, the rebuilt store's row counts must match what was prepared:

- `material` count == one per migrated item.
- `search_unit` count == total preserved chunks across those items.
- `embedding` count == distinct embedding-text hashes across the base.
- Every `search_text` row must resolve to a stored `embedding` (zero uncovered
  units) — the migration-time form of the rebuild self-heal invariant: a unit with
  no backing vector is silently absent from vector search.

## Skipped Data

- Bases missing from migrated `knowledge_base`
- Bases marked `failed` or with `embeddingModelId = null`
- Bases with invalid `dimensions`
- Bases whose legacy DB file is missing, resolves to a directory, or does not contain a `vectors` table
- Vector rows whose `uniqueLoaderId` cannot be mapped to a migrated `knowledge_item.id`
- Vector rows mapped to non-indexable container item types such as `directory`, **only in the fallback path** (unreadable legacy sources, or an embedded file with no migratable vectors); the normal path re-attributes them to per-file children instead
- Vector rows with missing or empty `vector` payloads
- Vector rows whose `vector` payload exists but is exposed through an unsupported runtime encoding
- Vector rows whose `vector` length disagrees with the base's recorded `dimensions`

If every legacy vector row under one base is skipped, the rebuilt V2 store for that base is expected to be empty (schema + `meta` row only). This is intentional: only vectors that can be proven to belong to migrated `knowledge_item` rows remain valid in V2.
