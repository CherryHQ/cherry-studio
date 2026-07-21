import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

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

    // ─── External ───
    /** Absolute path to the user-provided file. Non-null iff origin='external' */
    externalPath: text(),

    // ─── Cleanup policy ───
    /**
     * Cleanup intent stored as data (docs/references/file/file-entry-cleanup.md §4).
     * 'manual' = keep at zero refs; 'delete_when_unreferenced' = the cleanup
     * pass may reclaim once zero persistent refs + no temp refs + past grace.
     * DB default 'manual' is the safe backstop; TS creation surfaces require
     * an explicit value.
     */
    cleanupPolicy: text().notNull().default('manual'),

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
    // Origin must be 'internal' or 'external'
    check('fe_origin_check', sql`${t.origin} IN ('internal', 'external')`),
    check('fe_cleanup_policy_check', sql`${t.cleanupPolicy} IN ('manual', 'delete_when_unreferenced')`),
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
    )
  ]
)
