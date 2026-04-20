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
 * - origin='internal': Cherry owns the content, stored at `{userData}/files/{id}.{ext}`
 *   name/ext/size are authoritative.
 * - origin='external': Cherry only references the user-provided path.
 *   name/ext/size are last-observed snapshots (refreshed on critical operations or manual refresh).
 */
export const fileEntryTable = sqliteTable(
  'file_entry',
  {
    id: uuidPrimaryKeyOrdered(),

    /** 'internal' | 'external' */
    origin: text().notNull(),

    // ─── Display / metadata ───
    /** User-visible name (without extension). internal: authoritative; external: snapshot of basename */
    name: text().notNull(),
    /** Extension without leading dot (e.g. 'pdf', 'md'). Null for extensionless files */
    ext: text(),
    /** File size in bytes. internal: authoritative; external: last-observed snapshot */
    size: integer().notNull(),

    // ─── External ───
    /** Absolute path to the user-provided file. Non-null iff origin='external' */
    externalPath: text(),

    // ─── Trash ───
    /** Non-null = trashed (ms epoch) */
    trashedAt: integer(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    index('fe_trashed_at_idx').on(t.trashedAt),
    index('fe_created_at_idx').on(t.createdAt),
    index('fe_external_path_idx').on(t.externalPath),
    // Partial unique: same externalPath at most once when not trashed.
    // createEntry(external) upserts against this index.
    uniqueIndex('fe_external_path_unique_idx')
      .on(t.externalPath)
      .where(sql`${t.origin} = 'external' AND ${t.trashedAt} IS NULL`),
    // Origin must be 'internal' or 'external'
    check('fe_origin_check', sql`${t.origin} IN ('internal', 'external')`),
    // externalPath must be non-null iff origin='external'
    check(
      'fe_origin_consistency',
      sql`(${t.origin} = 'internal' AND ${t.externalPath} IS NULL) OR (${t.origin} = 'external' AND ${t.externalPath} IS NOT NULL)`
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
