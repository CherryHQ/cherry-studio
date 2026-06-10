import type { SqliteExecutor } from './types'

/**
 * Per-base knowledge `index.sqlite` schema (9-table material model).
 *
 * This is the schema for the per-knowledge-base index database located at
 * `KnowledgeBase/{baseId}/.cherry/index.sqlite` — a SEPARATE file per base,
 * created fresh at runtime. It is NOT the main app DB and is intentionally
 * NOT managed by drizzle-kit (whose schema glob `src/main/data/db/schemas/**`
 * targets the main DB migration chain). See knowledge-technical-design.md §4.
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
 *   SQLite rowid. The FTS table uses `search_text`'s implicit `rowid`; callers
 *   MUST join `search_text_fts.rowid = search_text.rowid` and never treat
 *   `search_text_id` as the FTS rowid (technical-design §4.9 / §6.2).
 *
 * Foreign keys: this schema relies on `ON DELETE CASCADE` / `SET NULL`. SQLite
 * enforces foreign keys only when `PRAGMA foreign_keys = ON` is set per
 * connection, OUTSIDE any transaction (it is a no-op inside one). The store
 * opener is responsible for setting it on every connection it opens; this
 * module only declares the schema.
 */

/** Bump when the schema layout changes; persisted in `index_meta.schema_version`. */
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
  // index_meta — fixed single-row table (CHECK id = 1), not a key-value store.
  `CREATE TABLE IF NOT EXISTS index_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    base_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_scanned_at INTEGER,
    embedding_model_id_snapshot TEXT,
    dimensions_snapshot INTEGER,
    normalization_version INTEGER NOT NULL,
    chunker_version INTEGER NOT NULL,
    chunker_config_hash TEXT NOT NULL,
    ignore_rules_version INTEGER NOT NULL,
    CHECK (dimensions_snapshot IS NULL OR dimensions_snapshot > 0)
  )`,

  // content — normalized index text keyed by content hash; shareable across materials.
  `CREATE TABLE IF NOT EXISTS content (
    content_hash TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    text_format TEXT NOT NULL CHECK (text_format IN ('markdown', 'plain', 'extracted_text')),
    normalization_version INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  // material — stable identity, path and persistent failure summary of a file material.
  `CREATE TABLE IF NOT EXISTS material (
    material_id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'missing')),
    origin TEXT NOT NULL CHECK (origin IN ('user', 'processor', 'agent', 'captured', 'discovered')),
    index_policy TEXT NOT NULL CHECK (index_policy IN ('index', 'suppress', 'ignore')),
    current_content_hash TEXT,
    title TEXT,
    file_ext TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    mtime_ms INTEGER,
    last_seen_at INTEGER,
    missing_since INTEGER,
    last_indexed_at INTEGER,
    last_error_stage TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    last_failed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (current_content_hash) REFERENCES content(content_hash),
    CHECK (relative_path <> ''),
    CHECK (relative_path NOT LIKE '/%'),
    CHECK (relative_path <> '.cherry' AND relative_path NOT LIKE '.cherry/%'),
    CHECK (status != 'active' OR missing_since IS NULL),
    CHECK (status != 'missing' OR missing_since IS NOT NULL)
  )`,
  `CREATE INDEX IF NOT EXISTS material_status_idx ON material(status)`,
  `CREATE INDEX IF NOT EXISTS material_content_idx ON material(current_content_hash)`,
  `CREATE INDEX IF NOT EXISTS material_indexable_idx ON material(status, index_policy, relative_path)`,

  // material_relation — provenance between materials. PR A: DDL only, no write logic.
  `CREATE TABLE IF NOT EXISTS material_relation (
    relation_id TEXT PRIMARY KEY,
    relation_type TEXT NOT NULL CHECK (
      relation_type IN ('processed_from', 'summarized_from', 'captured_from', 'refreshed_from')
    ),
    source_material_id TEXT,
    target_material_id TEXT NOT NULL,
    source_ref_json TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (source_material_id) REFERENCES material(material_id) ON DELETE SET NULL,
    FOREIGN KEY (target_material_id) REFERENCES material(material_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS material_relation_source_idx ON material_relation(source_material_id)`,
  `CREATE INDEX IF NOT EXISTS material_relation_target_idx ON material_relation(target_material_id)`,
  `CREATE INDEX IF NOT EXISTS material_relation_type_idx ON material_relation(relation_type)`,

  // search_unit — agent-readable retrieval unit (chunk/heading section) with offsets.
  `CREATE TABLE IF NOT EXISTS search_unit (
    unit_id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    unit_type TEXT NOT NULL CHECK (
      unit_type IN ('chunk', 'heading_section', 'page', 'paragraph', 'manual')
    ),
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

  // content_index_entry — editable index entries (question/summary/keyword/tag). PR A: DDL only.
  `CREATE TABLE IF NOT EXISTS content_index_entry (
    entry_id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('question', 'summary', 'keyword', 'tag')),
    origin TEXT NOT NULL CHECK (origin IN ('manual', 'agent', 'imported', 'system')),
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (unit_id) REFERENCES search_unit(unit_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS content_index_entry_unit_idx ON content_index_entry(unit_id)`,
  `CREATE INDEX IF NOT EXISTS content_index_entry_kind_idx ON content_index_entry(kind)`,

  // search_text — unified retrieval-text projection shared by FTS and embedding.
  `CREATE TABLE IF NOT EXISTS search_text (
    search_text_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('search_unit', 'content_index_entry')),
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('body', 'title', 'question', 'summary', 'keyword', 'tag')),
    text TEXT NOT NULL,
    embedding_text_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS search_text_target_kind_idx ON search_text(target_type, target_id, kind)`,
  `CREATE INDEX IF NOT EXISTS search_text_embedding_hash_idx ON search_text(embedding_text_hash)`,
  `CREATE INDEX IF NOT EXISTS search_text_kind_idx ON search_text(kind)`,

  // embedding — current embedding vector keyed by embedding-text hash.
  // vector_blob is a plain BLOB of raw little-endian float32 bytes (NOT F32_BLOB),
  // so it stays byte-identical across libsql and better-sqlite3 + sqlite-vec.
  `CREATE TABLE IF NOT EXISTS embedding (
    embedding_text_hash TEXT PRIMARY KEY,
    vector_blob BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  // search_text_fts — external-content FTS5 over search_text.text, trigram tokenizer.
  // Uses search_text's implicit rowid (content_rowid='rowid'); join on rowid to recover columns.
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_text_fts USING fts5(
    text,
    content='search_text',
    content_rowid='rowid',
    tokenize='trigram'
  )`,
  `CREATE TRIGGER IF NOT EXISTS search_text_ai AFTER INSERT ON search_text BEGIN
    INSERT INTO search_text_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS search_text_ad AFTER DELETE ON search_text BEGIN
    INSERT INTO search_text_fts(search_text_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS search_text_au AFTER UPDATE OF text ON search_text BEGIN
    INSERT INTO search_text_fts(search_text_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
    INSERT INTO search_text_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
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
 * Does NOT insert the `index_meta` row — that requires runtime values (base id,
 * model/dimension snapshot, contract versions) and is owned by the store-open path.
 */
export async function createKnowledgeIndexSchema(executor: SqliteExecutor): Promise<void> {
  for (const statement of KNOWLEDGE_INDEX_SCHEMA_STATEMENTS) {
    await executor.execute(statement)
  }
}
