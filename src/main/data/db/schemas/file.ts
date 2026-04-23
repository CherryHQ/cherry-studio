import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * NOTE: `file_upload` (AI provider upload cache) is intentionally NOT included
 * in Phase 1a — deferred until Vercel AI SDK's Files Upload API exits pre-release
 * status. Design is preserved in file-manager-architecture.md §9 for future reference.
 */

/**
 * File entry table — all files managed by Cherry.
 *
 * Flat list; no tree structure, no mount concept.
 *
 * - origin='internal': Cherry owns the content, stored at `{userData}/files/{id}.{ext}`.
 *   `name` / `ext` / `size` are authoritative (kept in sync by atomic writes).
 * - origin='external': Cherry only references the user-provided path.
 *   `name` / `ext` are pure projections of `externalPath` (basename / extname).
 *   `size` is NOT stored for external — external files can change outside
 *   Cherry at any time, so a DB snapshot would inevitably drift. Consumers
 *   needing a live value call File IPC `getMetadata(id)` which runs `fs.stat`.
 */
export const fileEntryTable = sqliteTable(
  'file_entry',
  {
    id: uuidPrimaryKeyOrdered(),

    /** 'internal' | 'external' */
    origin: text().notNull(),

    // ─── Display / metadata ───
    /** User-visible name (without extension). internal: authoritative; external: basename of externalPath */
    name: text().notNull(),
    /** Extension without leading dot (e.g. 'pdf', 'md'). Null for extensionless files */
    ext: text(),
    /**
     * File size in bytes. Non-null iff origin='internal' (enforced by
     * `fe_size_internal_only`). For external entries this is always NULL; the
     * live value is read via File IPC `getMetadata`.
     */
    size: integer(),

    // ─── External ───
    /** Absolute path to the user-provided file. Non-null iff origin='external' */
    externalPath: text(),

    // ─── Trash ───
    /**
     * Non-null = trashed (ms epoch). Internal-only.
     *
     * External entries cannot be trashed (enforced by `fe_external_no_trash`
     * check constraint). Their lifecycle is monotonic: create via
     * `ensureExternalEntry`, update in place, or remove immediately via
     * `permanentDelete` (DB-only — the physical file is left untouched;
     * path-level deletion is a separate, explicit unmanaged `ops.remove(path)`).
     */
    trashedAt: integer(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    index('fe_trashed_at_idx').on(t.trashedAt),
    index('fe_created_at_idx').on(t.createdAt),
    // Global unique on externalPath. Internal rows (externalPath = null) are
    // exempt — SQLite treats multiple NULLs as distinct in a UNIQUE index.
    // This makes `ensureExternalEntry` a pure upsert keyed by path, with no
    // ambiguity from historical duplicates. Doubles as the lookup index.
    uniqueIndex('fe_external_path_unique_idx').on(t.externalPath),
    // Origin must be 'internal' or 'external'
    check('fe_origin_check', sql`${t.origin} IN ('internal', 'external')`),
    // externalPath must be non-null iff origin='external'
    check(
      'fe_origin_consistency',
      sql`(${t.origin} = 'internal' AND ${t.externalPath} IS NULL) OR (${t.origin} = 'external' AND ${t.externalPath} IS NOT NULL)`
    ),
    // External entries cannot be trashed — trash/restore is internal-only.
    // External removal is always immediate via permanentDelete (DB-only; the
    // physical file is left untouched, path-level ops.remove is a separate call).
    check('fe_external_no_trash', sql`${t.origin} != 'external' OR ${t.trashedAt} IS NULL`),
    // Size semantics are origin-dependent: internal rows carry an authoritative
    // byte count (non-null, ≥ 0); external rows must leave size NULL and read
    // live values from File IPC `getMetadata`. The Zod layer rejects the same
    // shapes, but anything that bypasses Zod (direct Drizzle insert from a
    // migrator or a buggy test harness) would otherwise leak into the DB.
    // Belt-and-suspenders: keep invariants at both ends.
    check(
      'fe_size_internal_only',
      sql`(${t.origin} = 'internal' AND ${t.size} IS NOT NULL AND ${t.size} >= 0) OR (${t.origin} = 'external' AND ${t.size} IS NULL)`
    )
  ]
)

/**
 * File reference table — tracks which business entities reference which file entries.
 *
 * Polymorphic association: sourceType + sourceId identify the referencing entity.
 * No FK constraint on sourceId (polymorphic). Application-layer cleanup required
 * when source entities are deleted.
 *
 * fileEntryId has CASCADE delete: removing a file entry auto-removes its references.
 */
export const fileRefTable = sqliteTable(
  'file_ref',
  {
    id: uuidPrimaryKey(),

    // Referenced file entry ID
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),

    // Business source type (e.g. 'chat_message', 'knowledge_item', 'painting', 'note')
    sourceType: text().notNull(),
    // Business object ID (polymorphic, no FK constraint)
    sourceId: text().notNull(),
    // Reference role (e.g. 'attachment', 'source', 'asset')
    role: text().notNull(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    index('file_ref_entry_id_idx').on(t.fileEntryId),
    index('file_ref_source_idx').on(t.sourceType, t.sourceId),
    uniqueIndex('file_ref_unique_idx').on(t.fileEntryId, t.sourceType, t.sourceId, t.role)
  ]
)
