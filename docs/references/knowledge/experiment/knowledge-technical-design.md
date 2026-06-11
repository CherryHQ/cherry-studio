# Cherry Studio Knowledge Base — Technical Design

## 1. Scope

The v2 goal: align the knowledge base's underlying data shape with the future folder-style design — one engine-portable `KnowledgeBase/{baseId}/.cherry/index.sqlite` per base (7-table material model), so the v2 → v2.x switch only moves/reuses the index. The global `knowledge_base` / `knowledge_item` tables stay; embedding remains required (no FTS-only mode; BM25-only degradation is v2.x).

**Status (2026-06-11)**: PR A has landed — the 7-table layout + `KnowledgeIndexStore` exist, `search()` and the indexing job run on the new store, and the runtime no longer reads the legacy single-table `libsql_vectorstores_embedding` layout (the `external_id` API and `deleteItemChunk` are gone). Two transitional caveats remain until PR B:

- `KnowledgeVectorMigrator` still **writes** the legacy single-table layout into the same `index.sqlite` the runtime opens, so a migrated base mounts as an *empty* index — search returns nothing until the base is reindexed. The store-open path detects the legacy remnant (and the broader "completed items but empty index" state) and logs an error; an integration test pins this contract and must be rewritten with PR B.
- `index_meta.chunker_config_hash` is stamped but not yet compared, so chunk-size/overlap edits do not trigger a rebuild (see §4.1).

**PR B is therefore a hard blocker for v2 GA and for any build that enables the v1 knowledge migration for real users.**

Still to do: PR B (migrator writes the final layout + url/note `.md` snapshots + conflict keep-copy) and PR C (agent-first retrieval surface + locator/read).

## 2. Storage layout

```text
KnowledgeBase/{baseId}/
  .cherry/index.sqlite   # hidden per-base index DB (derived, rebuildable)
  paper.pdf              # user-uploaded source file
  paper.md               # processor output (next to its source)
  captures/{url,note}/   # URL / note markdown snapshots (PR B)
```

- `.cherry/**` is a reserved prefix and never enters the `material` table.
- `material.relative_path` is the real relative path under the base directory; path safety is enforced in the main process by `assertSafeKnowledgeRelativePath` (zod only validates shape).
- Key identity convention: `knowledge_item.id = material.material_id` (a leaf item's id is used directly as the material id).

## 3. Data model

`knowledge_item.data` persists the local `relativePath` shape; external paths / URLs / note content are only command input. The file indexing path is `indexedRelativePath ?? relativePath`. The url/note `.md` snapshot model belongs to PR B (today urls are still fetched live and notes carry inline content).

## 4. index.sqlite schema (7 tables)

| Table | Usage | Purpose |
| --- | --- | --- |
| `index_meta` | active | The index DB's fixed single "identity + contract" row: which base this index belongs to, and which embedding model · dimensions · chunker config the stored vectors/chunks were built with. `base_id` is verified on open; contract-driven rebuilds are future work |
| `material` | active | One stable identity row per material (file / URL / note): relative path, status (active/missing), origin, index policy; every other table hangs off `material_id` |
| `content` | active | The normalized full text of a material, stored once per content hash (identical text is shared across materials); the source text chunks are sliced from |
| `search_unit` | active | A retrieval unit (chunk) cut from `content`, positioned by `char_start/char_end`; `unit_id` is stable |
| `search_text` | active | The text projection that actually enters retrieval: both FTS and embedding read from here, decoupled from raw `content` |
| `embedding` | active | The vector for a piece of retrieval text, keyed by text hash (plain BLOB); identical text embeds once and is reused by any `search_text` row |
| `search_text_fts` | created + synced | FTS5 full-text index (trigram) over `search_text`; the keyword/BM25 lane |

Data flow: `material` → `content` (full text) → `search_unit` (chunks) → `search_text` (the indexed text per chunk) → the two retrieval lanes, `embedding` (vectors) and `search_text_fts` (full-text); `index_meta` anchors the contract the index was built under.

Planned v2.x surface — material provenance relations (e.g. PDF → generated Markdown) and editable index entries ("gets better with use") — is **not pre-created**: the DDL replays under `IF NOT EXISTS` on every open and the index is a rebuildable derived artifact, so adding a table or widening a CHECK lands together with its first consumer at zero cost, while pre-created vocabulary would lock in guesses (SQLite CHECKs cannot be ALTERed). The PDF→Markdown relation is expressed today by `relativePath`/`indexedRelativePath` in `knowledge_item.data`.

DDL lives in `indexStore/schema.ts` (per-base DB, not part of the main-DB drizzle migration chain).

### 4.1 index_meta

Fixed single row. `base_id` must equal the directory's `{baseId}` — verified by `ensureIndexMeta` on open; a mismatch refuses the mount (prevents mounting another base's index). That mismatch is the **only** refusal: a blank or recreated file has no row to mismatch and is stamped as a fresh empty index — the store-open path logs an error when that happens under a base that already has completed items. `embedding_model_id_snapshot` / `dimensions_snapshot` / `chunker_config_hash` are contract snapshots; snapshot-comparison-driven rebuilds are future work (changing model/dimensions goes through a full base restore today, and **chunk size / overlap edits intentionally do not trigger a rebuild yet** — the comparison consumer plus rebuild trigger is PR B scope, so until then an edited chunker config only affects newly indexed materials). `schema_version` is the version cursor for future forward-only migrations (no runner yet; during development, schema changes mean deleting and rebuilding the per-base DB).

### 4.2 material

- `status`: `active` / `missing` (no soft delete). Nothing writes `missing` yet — it is consumed on the read side (every search lane filters `status = 'active'`) and reserved for the v2.x watcher; the CHECK encodes its invariant (`missing` requires `missing_since`).
- `origin`: `user` (uploaded) / `processor` (MinerU Markdown etc.) / `captured` (URL/note snapshots). A file indexed through a processor output (has `indexedRelativePath`) is `processor`; indexed directly it is `user`. Watcher/agent origins join the CHECK with their writers (v2.x).
- `index_policy`: `index` / `suppress` (kept but not indexed, e.g. a PDF whose md was generated) / `ignore`. Consumed on the read side (lanes filter `index_policy = 'index'`).
- Descriptive fields (`title` / `mime_type` / `size_bytes` / `mtime_ms` …) are left empty for now — no consumer; they get backfilled when the v2.x material scanner (watcher/scan) lands.

### 4.3 content

`content_hash` is derived from the normalized text; identical content is shared by multiple materials. Chunk ranges are marked by `search_unit.char_start/char_end`.

### 4.4 search_unit and the stable unit_id

```text
unit_id = hash(material_id + content_hash + unit_type + unit_index + char_start + char_end)
```

Rebuilding the same material/content/chunker result reproduces the same `unit_id`. The id deliberately **excludes** `chunker_config_hash` — a chunker contract change is resolved by a full rebuild driven by `index_meta.chunker_config_hash` (once the comparison lands, see §4.1), not by baking the config into every unit id.

### 4.5 search_text

Unique on `(target_type, target_id, kind)`; both FTS and vectors enter through `search_text.text`. `embedding_text_hash` can be shared by multiple `search_text` rows, so `embedding` has no FK and vector reachability is judged by `EXISTS`.

### 4.6 embedding

`embedding_text_hash` is the primary key; **no** per-row model/dimensions (changing model or dimensions requires clearing and re-embedding — old-dimension vectors are never mixed). Stored as an engine-neutral plain BLOB (see §5.6 / decision A1).

### 4.7 search_text_fts

External-content FTS5 (trigram). **FTS hits must join back through `search_text.rowid = search_text_fts.rowid`** — `search_text_id` is a TEXT business key, not the FTS rowid.

## 5. Index interface and implementation notes

### 5.1 KnowledgeIndexStore interface

```ts
interface KnowledgeIndexStore {
  rebuildMaterial(materialId: string, input: RebuildMaterialInput): Promise<void>
  deleteMaterial(materialId: string): Promise<void>
  listMaterialUnits(materialId: string): Promise<KnowledgeSearchUnit[]>
  listExistingEmbeddingHashes(hashes: string[]): Promise<Set<string>>
  search(input: KnowledgeIndexSearchInput): Promise<KnowledgeIndexSearchMatch[]>
  close(): Promise<void>
}
```

Compatibility mapping: `materialId = knowledge_item.id`, `chunkId = search_unit.unit_id`, legacy result `content = search_text.text`, `itemId = material_id`.

### 5.2 rebuildMaterial atomic replace

Inside one write transaction: upsert material/content → delete old `search_unit`/`search_text` → insert new → FTS synced by triggers → insert missing embeddings → verify every unit's embedding hash resolves to a vector → update material metadata. Old and new chunks are never visible mixed. Deleting old `search_text` must **not** delete embeddings directly (they may be shared); orphaned vectors — and, on a content-changed reindex with no delete, the previous `content` row — are left to a later GC (PR B/C, which must run under the base mutation lock).

**Decision A4 (embedding reuse)**: a stored vector is reused on exact "text fingerprint (`embedding_text_hash`) + model + dimensions" equality, and only hashes missing from the index get embedded — reindexing unchanged content no longer spends embedding API money.

### 5.3 chunk offset invariant

```ts
content.text.slice(charStart, charEnd) === bodySearchText.text
```

A chunk body must be a verbatim slice of `content.text` (the offset-preserving splitter keeps offsets while splitting); inferring offsets afterwards with a naive `indexOf` is **forbidden** (repeated passages would mismatch). The store enforces the write half of this at rebuild time: a unit whose `charEnd` lies beyond the content text is rejected instead of silently clamped.

### 5.4 embedding contract

`knowledge_base.embeddingModelId` / `dimensions` must be valid; `embedMany` results are strictly dimension-checked and mismatching vectors are rejected.

### 5.5 embedding / rerank via AiService

`utils/indexing/embed.ts` → `AiService.embedMany`, `rerank.ts` → `AiService.rerank`, reusing the provider the user configured on the chat side (`provider::model` UniqueModelId). No local ONNX inference stack. Persistent rerank misconfiguration (401/403/404) escalates to an error log; transient failures fall back to the un-reranked results.

### 5.6 Engine portability (libsql ↔ better-sqlite3 + sqlite-vec)

`.cherry/index.sqlite` shares one schema across both engines — **switching needs zero user migration**:

1. Relational tables use generic SQLite DDL only; FTS5 is built into both engines; CJK handling lives in the application layer.
2. **Decision A1**: the canonical vector storage is a plain `BLOB` column holding little-endian float32 bytes (not libsql's proprietary `F32_BLOB`); it is the source of truth and both engines read the same bytes.
3. First-version vector retrieval is a brute-force scan over the canonical BLOBs (libsql `vector_distance_cos` / sqlite-vec `vec_distance_cosine`), exposed through the `VectorIndex` adapter; **no** vec0 / ANN derived index (left as a purely additive change after performance evaluation).
4. A thin `SqliteDriver` port (execute / transaction / close) so the store is written once; the libsql driver uses a per-driver write mutex + WAL/busy_timeout PRAGMAs to avoid SQLITE_BUSY from libsql client-ts #288.

## 6. Retrieval

`KnowledgeIndexStore.search()` is the **single retrieval entry point** for both lanes: BM25 (`search_text_fts`) / vector (`embedding`) / hybrid (RRF fusion — rank-based, so the two incompatible score scales need no normalization). Results join `search_unit → material`, filtering `material.status = 'active'` and `index_policy = 'index'`; the caller additionally filters `knowledge_item.status = 'completed'`. No vector-less degradation (BM25-only) until v2.x — a missing embedding errors out today.

### 6.1 search() wiring and retrieval tuning

`searchMode` / `hybridAlpha` / `documentCount` / `threshold` are all **base-level configuration** (`knowledge_base` columns) for now; `search()` reads them from the base row (result cap `documentCount ?? 10`).

> **Decision note (2026-06-10)**: `hybridAlpha` describes whether a base's corpus leans lexical or semantic — a stable property of the base, not something the model should guess per call — so it stays a base column with the RagConfig slider (configurable only in hybrid mode; cleared when `searchMode` moves away). `threshold` only applies to relevance-scored hits (vector mode, or after rerank) and is a no-op for BM25/RRF ranking scores (`applyRelevanceThreshold` in `utils/search.ts`). Researched and decided, but **deferred to a later PR**: `topK` / `threshold` become per-call knobs (`KnowledgeSearchOptions`, exposed through `kb__search` arguments and REST `top_k`), and the `documentCount` column is removed with them. That refactor was implemented during PR A's development and then deliberately carved out to keep PR A reviewable; it will be re-done on top of the merged PR A in the per-call-tuning PR — the paragraph above records the agreed design so nothing depends on any developer-local state.

### 6.2 Legacy result shape mapping

`pageContent = body search_text.text`, `itemId = material_id`, `chunkId = unit_id`, `metadata.chunkIndex = unit_index`. Material-level results + `locator` / `read(locator)` belong to PR C. Note for PR C: `kb__search` currently clamps scores to the AI-SDK schema's `[0, 1]`, which collapses BM25-mode magnitudes (>1 ties at 1; LIKE-fallback negatives tie at 0) while result *order* is computed before the clamp — PR C owns the score-semantics redesign (`scoreKind` is already plumbed through).

## 7. Follow-up work

- **PR B** (hard blocker for v2 GA / enabling the v1 migration, see §1): migrator writes the 7-table final layout (replacing the transitional legacy-remnant detection at store open), url/note `.md` snapshots, conflict "keep copy (auto-rename)", restore copies processed md, orphan embedding/content GC, `chunker_config_hash` comparison + rebuild trigger.
- **PR C (v2.x)**: material-level results + locator/read, editable index entries (with their `content_index_entry` table), kb__read / kb__tree / kb__manage tool surface, BM25-only degradation, per-result score semantics.
- **Operational hardening (PR B / later, surfaced in the PR #15973 review)** — pre-existing main-process / concurrency behaviours the engine cutover inherits, not regressions introduced by PR A, deferred here on purpose:
  - An intake file-size cap (`fs.stat`) before the synchronous main-process chunker — a large text file otherwise blocks the window for seconds and the job retry policy replays the freeze.
  - An explicit `maxParallelCalls` (plus token-aware batching) for `AiService.embedMany`, so one large document cannot fan out unbounded batches, exceed provider per-request token limits, and discard embeddings already paid for in a failed attempt.
  - Startup-recovery cross-cancellation: a crash-recovered delete-subtree job and the `recoverDeletingItems` re-enqueue get different idempotency keys and cancel each other via roots-intersection (`jobTouchesSubtree`); cancel only jobs whose roots are fully covered by the current job's roots.
  - Hybrid search runs its two lanes as independent read snapshots; a rebuild committing between them can transiently return both copies of a chunk — close with a shared read transaction or a second dedupe by material id + unit index.
  - `LibsqlDriver.close()` does not take the write mutex; shutdown safety currently rests on JobManager draining before the store service stops — wrapping close in `runExclusive` hardens it.
  - Retrieval-surface follow-ups (PR C): the `searchMode` `default`→`vector` rename is externally visible through the gateway's pass-through base entity, and a permanent open failure (legacy layout) currently maps to a retryable 503.
- PR A's full test matrix and risk notes live in this repo's test suites (`src/main/features/knowledge/**/__tests__`) and the PR #15973 description.
