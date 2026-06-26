import type { SqliteExecutor } from './types'

/**
 * Per-base knowledge `index.sqlite` schema (7-table material model).
 *
 * This is the schema for the per-knowledge-base index database located at
 * `KnowledgeBase/{baseId}/.cherry/index.sqlite` — a SEPARATE file per base,
 * created fresh at runtime. It is NOT the main app DB and is intentionally
 * NOT managed by drizzle-kit (whose schema glob `src/main/data/db/schemas/**`
 * targets the main DB migration chain). See knowledge-technical-design.md §4.
 *
 * Demand-first surface: tables and enum values ship together with their first
 * writer. Planned v2.x surface (material provenance relations, editable index
 * entries, watcher-driven origins/states) is NOT pre-created — since this DDL
 * replays under `IF NOT EXISTS` on every open and the index is a rebuildable
 * derived artifact, adding a table or widening a CHECK later is a zero-cost
 * additive change, while pre-created vocabulary would lock in guesses.
 *
 * Engine portability (technical-design §5.6 / decision A1):
 * - All DDL is plain, engine-neutral SQLite — no engine-specific column types
 *   or functions. The same statements run on libsql today and on
 *   better-sqlite3 + sqlite-vec later, with zero user migration.
 * - `embedding.vector_blob` is a plain `BLOB` holding raw little-endian float32
 *   bytes (NOT libsql's proprietary `F32_BLOB`). Both engines read the same
 *   bytes; vector similarity is computed by each engine's scalar distance
 *   function at query time (libsql `vector_distance_cos`, sqlite-vec
 *   `vec_distance_cosine`). No derived ANN index is created in this version.
 * - Because the embedding column is a dimensionless BLOB, the DDL takes no
 *   runtime parameters and is a static statement array — the same shape as
 *   `MESSAGE_FTS_STATEMENTS` in `src/main/data/db/schemas/message.ts`.
 *
 * FTS5 (decision A3):
 * - `search_text_fts` is an external-content FTS5 table over `search_text`,
 *   indexing only the `text` column with the `trigram` tokenizer, kept in sync
 *   by AFTER INSERT/DELETE/UPDATE triggers — copied from the canonical
 *   `message.ts` pattern. `kind` is filtered via the rowid join back to
 *   `search_text`, not stored in the FTS table (so triggers stay minimal).
 * - `search_text_id` is a TEXT business primary key, so it does NOT alias the
 *   SQLite rowid. The FTS table keys on `search_text.fts_rowid` (a stable integer
 *   surrogate the AFTER INSERT trigger assigns), NOT the implicit `rowid`; callers
 *   MUST join `search_text_fts.rowid = search_text.fts_rowid`. Keying on the
 *   implicit rowid would silently desync this external-content index whenever a
 *   VACUUM or table rebuild renumbers it (technical-design §4.7 / §6.2).
 *
 * Foreign keys: this schema relies on `ON DELETE CASCADE` / `SET NULL`. SQLite
 * enforces foreign keys only when `PRAGMA foreign_keys = ON` is set per
 * connection, OUTSIDE any transaction (it is a no-op inside one). The store
 * opener is responsible for setting it on every connection it opens; this
 * module only declares the schema.
 */

/** Bump when the schema layout changes; persisted in `meta.schema_version`. */
export const KNOWLEDGE_INDEX_SCHEMA_VERSION = 1

/**
 * Ordered, idempotent DDL for the per-base index database. Every statement uses
 * `IF NOT EXISTS` so re-running on an existing database is a no-op. Relational
 * *tables* may be created in any order because SQLite resolves foreign-key
 * targets at use time, not at CREATE time; but each `CREATE INDEX` must follow
 * its target table, and the FTS triggers must follow the FTS virtual table
 * (`IF NOT EXISTS` does not save a statement that references a not-yet-created
 * object — it would fail with "no such table").
 */
export const KNOWLEDGE_INDEX_SCHEMA_STATEMENTS: readonly string[] = [
  // meta — fixed single-row identity table (CHECK id = 1), not a key-value store.
  // 5 columns: which base this index belongs to + the schema-version cursor. Build
  // contract snapshots (model/dimensions/normalization/chunker) are not stored — a
  // model/dimension change creates a new base; a chunker change rebuilds the index.
  `CREATE TABLE IF NOT EXISTS meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    base_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // content — normalized index text keyed by content hash; shareable across materials.
  // content_hash = sha256(text); no normalization_version (the text already reflects
  // the rules) and no text_format (no consumer branches on it).
  `CREATE TABLE IF NOT EXISTS content (
    content_hash TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  // material — stable identity and path of a file material plus a pointer to its
  // current content. A pure retrieval projection of knowledge_item (the authority
  // for display metadata, lifecycle status and error). search_unit hangs off
  // material_id (FK + ON DELETE CASCADE); search() does not filter on material.
  `CREATE TABLE IF NOT EXISTS material (
    material_id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    current_content_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (current_content_hash) REFERENCES content(content_hash),
    CHECK (relative_path <> ''),
    CHECK (relative_path NOT LIKE '/%'),
    CHECK (relative_path <> '.cherry' AND relative_path NOT LIKE '.cherry/%')
  )`,
  `CREATE INDEX IF NOT EXISTS material_content_idx ON material(current_content_hash)`,

  // search_unit — agent-readable retrieval unit with offsets. unit_type carries a
  // single value today; new granularities join the CHECK with their first writer.
  `CREATE TABLE IF NOT EXISTS search_unit (
    unit_id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    unit_type TEXT NOT NULL CHECK (unit_type IN ('chunk')),
    unit_index INTEGER NOT NULL,
    title TEXT,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    locator_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (material_id) REFERENCES material(material_id) ON DELETE CASCADE,
    FOREIGN KEY (content_hash) REFERENCES content(content_hash) ON DELETE CASCADE,
    CHECK (unit_index >= 0),
    CHECK (char_start >= 0),
    CHECK (char_end >= char_start)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS search_unit_material_index_idx ON search_unit(material_id, unit_type, unit_index)`,
  `CREATE INDEX IF NOT EXISTS search_unit_content_idx ON search_unit(content_hash)`,
  `CREATE INDEX IF NOT EXISTS search_unit_material_idx ON search_unit(material_id)`,

  // search_text — unified retrieval-text projection shared by FTS and embedding.
  // target_type/kind each carry a single value today (unit body text); richer
  // projections (titles, editable index entries) join the CHECKs with their writers.
  // fts_rowid is the stable integer key search_text_fts indexes on (content_rowid='fts_rowid'),
  // NOT the implicit rowid. It is a real column, so VACUUM and any INSERT...SELECT rebuild copy it
  // verbatim and the external-content FTS stays aligned by construction. Nullable by design: the
  // AFTER INSERT trigger fills it after the row exists (a NOT NULL column would reject the row
  // before the trigger runs). Never set by app code; like rowid it is a local-only physical id.
  `CREATE TABLE IF NOT EXISTS search_text (
    search_text_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('search_unit')),
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('body')),
    text TEXT NOT NULL,
    embedding_text_hash TEXT NOT NULL,
    fts_rowid INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS search_text_target_kind_idx ON search_text(target_type, target_id, kind)`,
  `CREATE INDEX IF NOT EXISTS search_text_embedding_hash_idx ON search_text(embedding_text_hash)`,
  `CREATE INDEX IF NOT EXISTS search_text_kind_idx ON search_text(kind)`,
  // UNIQUE so its backing index makes the trigger's per-row MAX(fts_rowid)+1 an O(log N) lookup and
  // rejects any duplicate loudly (the assignment is race-free only because the driver serializes
  // writes through its write mutex — see LibsqlDriver).
  `CREATE UNIQUE INDEX IF NOT EXISTS search_text_fts_rowid_uniq ON search_text(fts_rowid)`,

  // embedding — current embedding vector keyed by embedding-text hash.
  // vector_blob is a plain BLOB of raw little-endian float32 bytes (NOT F32_BLOB),
  // so it stays byte-identical across libsql and better-sqlite3 + sqlite-vec.
  `CREATE TABLE IF NOT EXISTS embedding (
    embedding_text_hash TEXT PRIMARY KEY,
    vector_blob BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  // search_text_fts — external-content FTS5 over search_text.text, trigram tokenizer.
  // Keys on the stable `fts_rowid` column (content_rowid='fts_rowid'), NOT the implicit rowid, so
  // VACUUM and INSERT...SELECT rebuilds — both of which renumber the implicit rowid — keep the
  // index aligned by construction (the same fix the chat message_fts tables use; see
  // schemas/message.ts). Join back on fts_rowid to recover columns; `kind` is filtered via that
  // join, not stored in the FTS table (so triggers stay minimal).
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_text_fts USING fts5(
    text,
    content='search_text',
    content_rowid='fts_rowid',
    tokenize='trigram'
  )`,
  // Assign fts_rowid here (not in app code) so every insert path is covered; the SELECT reads the
  // freshly-assigned value back (NEW.fts_rowid is still NULL at AFTER INSERT time). The fts_rowid-only
  // UPDATE does not fire search_text_au (which is scoped to UPDATE OF text).
  `CREATE TRIGGER IF NOT EXISTS search_text_ai AFTER INSERT ON search_text BEGIN
    UPDATE search_text SET fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM search_text)
      WHERE search_text_id = NEW.search_text_id;
    INSERT INTO search_text_fts(rowid, text)
    SELECT fts_rowid, text FROM search_text WHERE search_text_id = NEW.search_text_id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS search_text_ad AFTER DELETE ON search_text BEGIN
    INSERT INTO search_text_fts(search_text_fts, rowid, text) VALUES ('delete', OLD.fts_rowid, OLD.text);
  END`,
  // fts_rowid is stable across a text edit, so it is not reassigned — only the FTS row is re-keyed.
  `CREATE TRIGGER IF NOT EXISTS search_text_au AFTER UPDATE OF text ON search_text BEGIN
    INSERT INTO search_text_fts(search_text_fts, rowid, text) VALUES ('delete', OLD.fts_rowid, OLD.text);
    INSERT INTO search_text_fts(rowid, text) VALUES (NEW.fts_rowid, NEW.text);
  END`
]

/**
 * Apply the index schema through an engine-neutral {@link SqliteExecutor} (e.g.
 * a LibsqlDriver). Statements run sequentially and are auto-committed
 * per-statement (no wrapping transaction); recovery from a mid-way failure
 * relies on every statement being `IF NOT EXISTS`, so re-running completes the
 * job — it is NOT all-or-nothing.
 *
 * Does NOT set `PRAGMA foreign_keys` — the driver's opener owns that and must
 * set it outside a transaction (see module doc; openLibsqlIndexDriver does).
 * Does NOT insert the `meta` row — that requires a runtime value (the base id)
 * and is owned by the store-open path.
 */
export async function createKnowledgeIndexSchema(executor: SqliteExecutor): Promise<void> {
  for (const statement of KNOWLEDGE_INDEX_SCHEMA_STATEMENTS) {
    await executor.execute(statement)
  }
}
