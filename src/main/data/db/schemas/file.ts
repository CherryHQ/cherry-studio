import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import {
  createUpdateDeleteTimestamps,
  createUpdateTimestamps,
  uuidPrimaryKey,
  uuidPrimaryKeyOrdered
} from './_columnHelpers'

/**
 * NOTE: `file_upload` (AI provider upload cache) is intentionally NOT included
 * — deferred until Vercel AI SDK's Files Upload API exits pre-release status.
 * Design is preserved in file-manager-architecture.md §9 for future reference.
 */

/**
 * File entry table — all files managed by Cherry.
 *
 * Flat list; no tree structure, no mount concept.
 *
 * - origin='internal': Cherry owns the content, stored at `{userData}/Data/Files/{id}.{ext}`.
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

    // ─── Content dedup ───
    /**
     * Content hash of the backing blob, format `{algo}:{hex}` (e.g.
     * `xxh3-64:9a0f…`). A **detection substrate** for content-level dedup —
     * NOT an identity and NOT a unique key. Identity stays `id` (UUID v7); a
     * hash collision at worst surfaces a wrong candidate that a consumer's
     * secondary check rejects, never mis-served bytes (hence the non-unique
     * `fe_content_hash_idx`).
     *
     * - internal: maintained on create + every write; NULL only during the
     *   backfill window (rows created before this feature) — a transitional
     *   state, not steady.
     * - external: always NULL — external content lives outside Cherry and is
     *   never hashed (enforced by `fe_contenthash_external_null`).
     *
     * Distinct from `fe_external_path_lower_unique_idx` (external *path*
     * identity) and from the on-demand hash behind `writeIfUnchanged` (an
     * ephemeral deep-compare, never persisted). See
     * `file-manager-architecture.md`.
     */
    contentHash: text(),

    // ─── External ───
    /** Absolute path to the user-provided file. Non-null iff origin='external' */
    externalPath: text(),

    // ─── Timestamps ───
    // `deletedAt` is soft-delete (NULL = not deleted). Internal-only —
    // external entries cannot be soft-deleted (enforced by
    // `fe_external_no_delete`); their lifecycle is monotonic: create via
    // `ensureExternalEntry`, update in place, or remove immediately via
    // `permanentDelete` (DB-only — the physical file is left untouched;
    // path-level deletion is a separate, explicit unmanaged
    // `@main/utils/file/fs.remove(path)`).
    ...createUpdateDeleteTimestamps
  },
  (t) => [
    index('fe_deleted_at_idx').on(t.deletedAt),
    index('fe_created_at_idx').on(t.createdAt),
    // Case-insensitive uniqueness for `externalPath`. SQLite indexes
    // expressions verbatim, so this index covers both the uniqueness
    // invariant ("no two external rows whose canonical paths agree under
    // case folding") AND the case-insensitive lookup path
    // (`WHERE lower(externalPath) = lower(?)`) that backs
    // `findCaseInsensitivePeers`. Internal rows (`externalPath = NULL`)
    // are exempt: SQLite treats multiple NULLs as distinct in a UNIQUE
    // index.
    //
    // Semantic note: on case-insensitive filesystems (macOS APFS default,
    // Windows NTFS default) `/foo/A.txt` and `/foo/a.txt` *are* the same
    // file, and this index correctly forbids a second entry. On
    // case-sensitive filesystems (Linux ext4, case-sensitive APFS volumes)
    // those are two different files — `ensureExternalEntry` resolves the
    // disambiguation at the application layer via `fs.realpath` before
    // any insert is attempted, so the DB constraint never fires
    // user-visibly on legitimate distinct-file references. See
    // `file-manager-architecture.md §1.2 Duplicate-entry detection on
    // insert`.
    uniqueIndex('fe_external_path_lower_unique_idx').on(sql`lower(${t.externalPath})`),
    // Plain index on the raw `externalPath` column backs byte-exact lookups
    // (`findByExternalPath`, rename re-finds, path-resolution call sites).
    // Without this the functional unique index alone cannot serve
    // `WHERE externalPath = ?` — SQLite would fall back to a seq scan.
    index('fe_external_path_idx').on(t.externalPath),
    // Non-unique index backing the content-dedup detection query
    // (`findInternalByContentHash`). Deliberately NOT unique: `contentHash` is a
    // detection substrate, not a key — multiple internal rows may legitimately
    // share a hash (identical content under different names), and a collision
    // must never raise a constraint violation.
    index('fe_content_hash_idx').on(t.contentHash),
    // Origin must be 'internal' or 'external'
    check('fe_origin_check', sql`${t.origin} IN ('internal', 'external')`),
    // externalPath must be non-null iff origin='external'
    check(
      'fe_origin_consistency',
      sql`(${t.origin} = 'internal' AND ${t.externalPath} IS NULL) OR (${t.origin} = 'external' AND ${t.externalPath} IS NOT NULL)`
    ),
    // External entries cannot be trashed — trash/restore is internal-only.
    // External removal is always immediate via permanentDelete (DB-only; the
    // physical file is left untouched, path-level @main/utils/file/fs.remove is a separate call).
    check('fe_external_no_delete', sql`${t.origin} != 'external' OR ${t.deletedAt} IS NULL`),
    // Size semantics are origin-dependent: internal rows carry an authoritative
    // byte count (non-null, ≥ 0); external rows must leave size NULL and read
    // live values from File IPC `getMetadata`. The Zod layer rejects the same
    // shapes, but anything that bypasses Zod (direct Drizzle insert from a
    // migrator or a buggy test harness) would otherwise leak into the DB.
    // Belt-and-suspenders: keep invariants at both ends.
    check(
      'fe_size_internal_only',
      sql`(${t.origin} = 'internal' AND ${t.size} IS NOT NULL AND ${t.size} >= 0) OR (${t.origin} = 'external' AND ${t.size} IS NULL)`
    ),
    // contentHash is internal-only: external content lives outside Cherry and is
    // never hashed. Softer than `fe_size_internal_only` — internal rows MAY
    // carry a NULL contentHash (backfill window / not yet computed), so this
    // only forbids the external⇒non-NULL combination.
    check('fe_contenthash_external_null', sql`${t.origin} != 'external' OR ${t.contentHash} IS NULL`)
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

    // Business source type — registered variants live in
    // `src/shared/data/types/file/ref/index.ts#allSourceTypes`; today
    // 'temp_session' and 'knowledge_item'. Stored as free-form text at the DB
    // layer so adding a new variant doesn't require a schema migration.
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
