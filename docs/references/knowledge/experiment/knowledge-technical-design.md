# Cherry Studio Knowledge Base — Technical Design

## 1. Scope

The v2 goal: align the knowledge base's underlying data shape with the future folder-backed design — one engine-portable `KnowledgeBase/{baseId}/.cherry/index.sqlite` per base (7-table material model), so the v2 → v2.x switch only moves/reuses the index. The global `knowledge_base` / `knowledge_item` tables stay **permanently** — `knowledge_item` is the business-state authority that drives the UI (no "exit path"; see §7), and the per-base folder is internal, Cherry-managed byte storage. Embedding remains required (no FTS-only mode; BM25-only degradation is v2.x).

**Status (2026-06-11)**: PR A has landed — the 7-table layout + `KnowledgeIndexStore` exist, `search()` and the indexing job run on the new store, and the runtime no longer reads the legacy single-table `libsql_vectorstores_embedding` layout (the `external_id` API and `deleteItemChunk` are gone). One transitional caveat remains until PR B:

- `KnowledgeVectorMigrator` still **writes** the legacy single-table layout into the same `index.sqlite` the runtime opens, so a migrated base mounts as an *empty* index — search returns nothing until the base is reindexed. The store-open path detects the legacy remnant (and the broader "completed items but empty index" state) and logs an error; an integration test pins this contract and must be rewritten with PR B.

**PR B is therefore a hard blocker for v2 GA and for any build that enables the v1 knowledge migration for real users.**

Still to do: PR B (migrator writes the final layout + url/note `.md` snapshots + conflict keep-copy) and PR C (agent-first retrieval surface + locator/read).

## 2. Storage layout

```text
KnowledgeBase/{baseId}/
  .cherry/index.sqlite      # hidden per-base index DB (derived, rebuildable)
  raw/                      # the single material root — all material bytes live here, flat
    paper.pdf               # user-uploaded source file
    paper.md                # processor output (sits beside its source)
    example-page.md         # captured URL snapshot (PR B)
    my-note.md              # captured note snapshot (PR B)
    <ownerId>/report.md     # a directory import keeps its own subtree nesting
```

- `raw/` is the **single material root**; every material's bytes live **flat** directly under it, keyed by file name. There is **no `<type>/` sub-partition** — type/origin always comes from `knowledge_item`, never from the path. The one nested case is a directory import: it keeps its *own* subtree (`raw/<ownerId>/<subtree>/…`), which is the imported folder's structure, not a type label.
- `.cherry/**` is a reserved prefix, a **sibling** of `raw/`, and never enters the `material` table.
- `material.relative_path` is relative to `raw/`; byte resolution is `{baseDir}/raw/{relative_path}`. No code parses the path to infer type/origin; those always come from `knowledge_item` (the derived `material` table no longer carries an `origin` column, see §4.2). Path safety is enforced in the main process by `assertSafeKnowledgeRelativePath` rooted at `raw/` (zod only validates shape).
- Processor output sits beside its source (`raw/paper.md` next to `raw/paper.pdf`); the source-vs-derived distinction is read from `knowledge_item` (`indexedRelativePath`), not from the directory or a `material` column.
- Key identity convention: `knowledge_item.id = material.material_id` (a leaf item's id is used directly as the material id).

## 3. Data model

`knowledge_item.data` persists the local `relativePath` shape; external paths / URLs / note content are only command input. The file indexing path is `indexedRelativePath ?? relativePath`. The url/note `.md` snapshot model belongs to PR B (today urls are still fetched live and notes carry inline content).

## 4. index.sqlite schema (7 tables)

| Table | Usage | Purpose |
| --- | --- | --- |
| `meta` | active | The index DB's fixed single identity row: which base this index belongs to (`base_id`, verified on open) plus the `schema_version` cursor. Build-contract snapshots (embedding model / dimensions / chunker) are **not** stored — a model/dimension change creates a new base, and a chunker change is resolved by rebuilding the throwaway index |
| `material` | active | One stable identity row per material (file / URL / note): relative path + current content pointer; every other table hangs off `material_id` |
| `content` | active | The normalized full text of a material, stored once per content hash (identical text is shared across materials); the source text chunks are sliced from |
| `search_unit` | active | A retrieval unit (chunk) cut from `content`, positioned by `char_start/char_end`; `unit_id` is stable |
| `search_text` | active | The text projection that actually enters retrieval: both FTS and embedding read from here, decoupled from raw `content` |
| `embedding` | active | The vector for a piece of retrieval text, keyed by text hash (plain BLOB); identical text embeds once and is reused by any `search_text` row |
| `search_text_fts` | created + synced | FTS5 full-text index (trigram) over `search_text`; the keyword/BM25 lane |

Data flow: `material` → `content` (full text) → `search_unit` (chunks) → `search_text` (the indexed text per chunk) → the two retrieval lanes, `embedding` (vectors) and `search_text_fts` (full-text); `meta` anchors the contract the index was built under.

Two once-planned v2.x tables are now settled (2026-06-12, see §7): **`material_relation`** (PDF→md provenance) is **dropped** — provenance lives in `knowledge_item.data` (`relativePath`/`indexedRelativePath`) plus `raw/` co-location, so the derived index never duplicates it. **`content_index_entry`** (editable "gets better with use" entries) is **deferred**; when it lands, its authoritative half must live in the main DB (keyed to `knowledge_item`/`material`) and project into `search_text` at build time, so `index.sqlite` stays purely derived. Neither is pre-created — the DDL replays under `IF NOT EXISTS` on every open and the index is a rebuildable derived artifact, so adding a table or widening a CHECK later is a zero-cost additive change, while pre-created vocabulary would lock in guesses (SQLite CHECKs cannot be ALTERed).

DDL lives in `indexStore/schema.ts` (per-base DB, not part of the main-DB drizzle migration chain).

### 4.1 meta

Fixed single row: `id, schema_version, base_id, created_at, updated_at` (5 columns). `base_id` must equal the directory's `{baseId}` — verified by `ensureIndexMeta` on open; a mismatch refuses the mount (prevents mounting another base's index). That mismatch is the **only** refusal: a blank or recreated file has no row to mismatch and is stamped as a fresh empty index — the store-open path logs an error when that happens under a base that already has completed items. `schema_version` is the version cursor for future forward-only migrations (no runner yet; during development, schema changes mean deleting and rebuilding the per-base DB). **Trimmed to the 5-column identity row (2026-06-12):** all build-contract snapshots are removed — `embedding_model_id_snapshot` / `dimensions_snapshot` / `normalization_version` / `chunker_version` / `chunker_config_hash` (all were write-only, never read; a model/dimension change creates a new base, and a chunker change is handled by rebuilding the throwaway index rather than by comparing a stored hash — the comparison can be re-added when the rebuild-trigger feature actually lands), plus the scanner-only `last_scanned_at` / `ignore_rules_version` (there is no watcher/scanner). See §7.

### 4.2 material

- `material` is retrieval-engine-internal — the UI reads `knowledge_item`, never this table (see §7). With `status` and `index_policy` both cut, `search()` applies **no material-level filter** at all: `search_unit` hangs off `material_id` via an FK (`ON DELETE CASCADE`), so a unit always has a live material without any join-time check.
- **Trimmed to a 5-column retrieval projection of `knowledge_item` (2026-06-12).** Removed columns: display metadata (`title` / `file_ext` / `mime_type` / `size_bytes`) → lives on `knowledge_item`, not the derived index; persistent failure fields (`last_error_stage` / `last_error_code` / `last_error_message` / `last_failed_at`) → the authoritative error is `knowledge_item.error`; watcher-only fields (`mtime_ms` / `last_seen_at`) → removed with the watcher; `origin` (write-only, never read by any search lane — derivable from `knowledge_item`); `missing_since` / `last_indexed_at` (both write-only); and `status` (`active` / `missing`) + `index_policy` (`index` / `suppress` / `ignore`) — both no-ops today: no writer ever set a non-default value (`status` never `missing`; `index_policy` always `index` — `toMaterialRelativePath` collapses a PDF→md item to one `index` material, and a no-processing PDF is itself the single `index` material), so their search-lane filters were always true. Neither is pre-created; each is re-added with its first real writer — `status` in PR B (a read/reindex hitting an absent file), `index_policy` in v2.x (when a source PDF becomes its own `suppress` material). Kept columns are just the identity/GC anchor: `material_id`, `relative_path`, `current_content_hash`, `created_at`, `updated_at`.

### 4.3 content

Three columns: `content_hash, text, created_at`. `content_hash = sha256(text)` over the normalized text — identical content is shared by multiple materials. **Trimmed to 3 columns (2026-06-12):** `normalization_version` (both the column and its inclusion in the hash input) and `text_format` are dropped — the stored text already reflects the active normalization rules, so tracking which rule version produced a row is redundant. Chunk ranges are marked by `search_unit.char_start/char_end`.

### 4.4 search_unit and the stable unit_id

```text
unit_id = hash(material_id + content_hash + unit_type + unit_index + char_start + char_end)
```

Rebuilding the same material/content/chunker result reproduces the same `unit_id`. The id deliberately **excludes** the chunker config — a chunker contract change is resolved by a full rebuild of the throwaway index, not by baking the config into every unit id (the former `chunker_config_hash` snapshot was dropped, see §4.1).

### 4.5 search_text

Unique on `(target_type, target_id, kind)`; both FTS and vectors enter through `search_text.text`. `embedding_text_hash` can be shared by multiple `search_text` rows, so `embedding` has no FK and vector reachability is judged by `EXISTS`. The `search_text` / `search_unit` split buys two things: multi-projection (one unit indexed as `body` + future title / summary / editable entries, each its own `kind`) and embedding dedup across units. With editable entries deferred, it is effectively 1:1 today — kept because it is landed, tested code, but a candidate to merge into `search_unit` if multi-projection never lands.

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

`KnowledgeIndexStore.search()` is the **single retrieval entry point** for both lanes: BM25 (`search_text_fts`) / vector (`embedding`) / hybrid (RRF fusion — rank-based, so the two incompatible score scales need no normalization). Results come from `search_unit` (its `material_id` FK guarantees a live material, so no material-level filter is applied); the caller filters `knowledge_item.status = 'completed'`. No vector-less degradation (BM25-only) until v2.x — a missing embedding errors out today.

### 6.1 search() wiring and retrieval tuning

`searchMode` / `hybridAlpha` / `documentCount` / `threshold` are all **base-level configuration** (`knowledge_base` columns) for now; `search()` reads them from the base row (result cap `documentCount ?? 10`).

> **Decision note (2026-06-10)**: `hybridAlpha` describes whether a base's corpus leans lexical or semantic — a stable property of the base, not something the model should guess per call — so it stays a base column with the RagConfig slider (configurable only in hybrid mode; cleared when `searchMode` moves away). `threshold` only applies to relevance-scored hits (vector mode, or after rerank) and is a no-op for BM25/RRF ranking scores (`applyRelevanceThreshold` in `utils/search.ts`). Researched and decided, but **deferred to a later PR**: `topK` / `threshold` become per-call knobs (`KnowledgeSearchOptions`, exposed through `kb__search` arguments and REST `top_k`), and the `documentCount` column is removed with them. That refactor was implemented during PR A's development and then deliberately carved out to keep PR A reviewable; it will be re-done on top of the merged PR A in the per-call-tuning PR — the paragraph above records the agreed design so nothing depends on any developer-local state.

### 6.2 Legacy result shape mapping

`pageContent = body search_text.text`, `itemId = material_id`, `chunkId = unit_id`, `metadata.chunkIndex = unit_index`. Material-level results + `locator` / `read(locator)` belong to PR C. Note for PR C: `kb__search` currently clamps scores to the AI-SDK schema's `[0, 1]`, which collapses BM25-mode magnitudes (>1 ties at 1; LIKE-fallback negatives tie at 0) while result *order* is computed before the clamp — PR C owns the score-semantics redesign (`scoreKind` is already plumbed through).

## 7. Follow-up work

- **knowledge_item is the permanent authority — managed material library (decided 2026-06-12)**: The knowledge base is a *managed material library*, not a "scan-the-folder-and-render-by-FS" product. The UI is driven by `knowledge_item` business state (its lifecycle status machine), never by a live filesystem read. `knowledge_item` (global DB) is the **permanent** single authority for material existence + lifecycle status + error, and the only source the UI/business logic reads — there is no future "exit path" that drops it. Rationale: the per-base folder is hidden app-internal storage (`{userData}/Data/KnowledgeBase/{baseId}`) a normal user never navigates to; all import/export goes through Cherry, so the folder need not be self-describing. Imported originals are never tracked (`import = copy`, one-shot); the base folder is written **only** by Cherry. With no external writer on either side there is **no file watcher**, no proactive `missing` detection, no external-change reconciliation; missing-file handling, when it lands (PR B), is a lazy flag set only when a read/reindex hits an absent file (re-adding a `material.status` column with that first writer — it is not pre-created today, see §4.2), never a proactive scan. Consequences: `index.sqlite` stays a derived, rebuildable artifact whose rebuild input is "`knowledge_item` ⊕ the base folder's bytes"; `material` is retrieval-engine-internal (only `search()` reads it). No new `knowledge_item` status is added — the existing 8 already express the managed lifecycle; "retry" is an action (a re-embed button reusing `reindex-subtree`), not a status, and the "expired/stale" concept is dropped. Storage: all material bytes live **flat** under `raw/` (see §2). This **reverses** the product spec's "the real directory is the user-visible truth" principle and the "UI is driven by the real directory" hard-to-roll-back decision.
- **Agent management uses the same primitives — no "LLM wiki" layer is baked into the schema (decided 2026-06-12)**: An agent that organizes a base (summaries, dedup, generated overviews, or any other style) does so through the **same write/delete/refresh primitives a user has** — its output becomes an ordinary `knowledge_item` that embeds and shows in the UI, indistinguishable at the schema level from a user upload (same `material` row, no `kind`/`origin` discriminator). We explicitly **defer** the whole wiki-specific apparatus rather than commit the data model to one management paradigm: no `knowledge_artifact_source` provenance/dependency table, no `knowledge_item.kind`, no `processed/` "derived" partition (material bytes stay flat under `raw/` — see §2), and no `knowledge check` staleness tool. Rationale: how a base is managed is the user's/agent's decision and may never be "wiki"; baking provenance + staleness in now would lock in a guessed paradigm (the "no speculative abstraction" rule in CLAUDE.md). Deferral is free — these are main-DB tables/columns addable at any time, and pre-release schema is regenerated wholesale — so the minimal schema for a paradigm (e.g. provenance + source-content-hash snapshots for staleness, modeled on qmd's `wiki_sources` + `wiki_ingest_tracker`) is added only when that paradigm actually proves out. The provenance authority, when it lands, must live in the main DB next to `knowledge_item` (FK + cascade; it records non-recomputable history, so it cannot live in the throwaway index). An optional neutral `knowledge_item.created_by: user | agent` tag (purely for an "AI-created" badge) was likewise considered and deferred for lack of a current consumer.
- **Organization is a logical layer, never mirrored onto the directory (decided 2026-06-13)**: A base's organization — the `knowledge_item.groupId` tree plus display names — is decoupled from the physical `material.relative_path`. Reorganizing, whether a user drags one item or an agent bulk-tidies a messy base, is a pure `knowledge_item.groupId` metadata update; a material's `relative_path` and on-disk bytes stay fixed for its lifetime and never move on regroup. We explicitly **reject** mirroring the UI tree onto the real directory (the "folder-as-source-of-truth" / Obsidian model): it would re-couple UI↔FS (reversing the managed-library decision above), turn every regroup into physical file moves whose partial failure diverges disk from DB, and force display-name→path-segment sanitization + collision handling — all worst precisely in the bulk "lazy user asks an agent to tidy up" case, where a metadata reorg is instead instant, atomic, and reversible. So `raw/` (flat) is the *physical* storage axis (stable, app-internal, never rendered) and the `groupId` tree is the *logical* axis (mutable, the only hierarchy the UI shows); they are orthogonal by design — the agent organizes the logical axis through the same `knowledge_item` primitives a user has (see the "Agent management uses the same primitives" decision above), and the physical layout need not agree.
- **PR B** (hard blocker for v2 GA / enabling the v1 migration, see §1): migrator writes the 7-table final layout (replacing the transitional legacy-remnant detection at store open), url/note `.md` snapshots, conflict "keep copy (auto-rename)", restore copies processed md, orphan embedding/content GC. (A chunker-change rebuild trigger is no longer pre-wired via a stored `chunker_config_hash` snapshot — that column was dropped; re-add the detection mechanism if/when the feature lands.)
- **PR C (v2.x)**: material-level results + locator/read, editable index entries (with their `content_index_entry` table), kb__read / kb__tree / kb__manage tool surface, BM25-only degradation, per-result score semantics.
- **Operational hardening (PR B / later, surfaced in the PR #15973 review)** — pre-existing main-process / concurrency behaviours the engine cutover inherits, not regressions introduced by PR A, deferred here on purpose:
  - An intake file-size cap (`fs.stat`) before the synchronous main-process chunker — a large text file otherwise blocks the window for seconds and the job retry policy replays the freeze.
  - An explicit `maxParallelCalls` (plus token-aware batching) for `AiService.embedMany`, so one large document cannot fan out unbounded batches, exceed provider per-request token limits, and discard embeddings already paid for in a failed attempt.
  - Startup-recovery cross-cancellation: a crash-recovered delete-subtree job and the `recoverDeletingItems` re-enqueue get different idempotency keys and cancel each other via roots-intersection (`jobTouchesSubtree`); cancel only jobs whose roots are fully covered by the current job's roots.
  - Hybrid search runs its two lanes as independent read snapshots; a rebuild committing between them can transiently return both copies of a chunk — close with a shared read transaction or a second dedupe by material id + unit index.
  - `LibsqlDriver.close()` does not take the write mutex; shutdown safety currently rests on JobManager draining before the store service stops — wrapping close in `runExclusive` hardens it.
  - Retrieval-surface follow-ups (PR C): the `searchMode` `default`→`vector` rename is externally visible through the gateway's pass-through base entity, and a permanent open failure (legacy layout) currently maps to a retryable 503.
- PR A's full test matrix and risk notes live in this repo's test suites (`src/main/features/knowledge/**/__tests__`) and the PR #15973 description.
