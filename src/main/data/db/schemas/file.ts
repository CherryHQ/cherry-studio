import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Mount table — storage configuration for file tree roots.
 *
 * Each mount defines a storage mode (local_managed, local_external, remote, system).
 * System mounts use well-known `systemKey` values; user-created mounts have systemKey = null.
 * Config fields are stored as independent columns (not JSON) since mount count is tiny (< 10).
 */
export const mountTable = sqliteTable(
  'mount',
  {
    id: uuidPrimaryKeyOrdered(),

    // System mount identifier: 'files' | 'notes' | 'temp' | 'trash' | null (user-created)
    systemKey: text(),
    // User-visible name
    name: text().notNull(),
    // Storage mode discriminator
    mountType: text().notNull(),

    // ─── local_managed / local_external fields ───
    basePath: text(),

    // ─── local_external fields ───
    watch: integer({ mode: 'boolean' }),
    watchExtensions: text({ mode: 'json' }).$type<string[]>(),

    // ─── remote fields ───
    apiType: text(),
    providerId: text(),
    cachePath: text(),
    autoSync: integer({ mode: 'boolean' }),
    remoteOptions: text({ mode: 'json' }).$type<Record<string, unknown>>(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    // System mount lookup
    uniqueIndex('mount_system_key_idx').on(t.systemKey),
    // Mount type constraint
    check('mount_type_check', sql`${t.mountType} IN ('local_managed', 'local_external', 'remote', 'system')`)
  ]
)

/**
 * File entry table — file and directory entries in the managed file tree.
 *
 * Uses adjacency list pattern (parentId) for tree navigation.
 * Trash is modeled via `trashedAt` timestamp — parentId never changes.
 */
export const fileEntryTable = sqliteTable(
  'file_entry',
  {
    id: uuidPrimaryKeyOrdered(),

    // ─── Core fields ───
    // Entry type: file | dir
    type: text().notNull(),
    // User-visible name (without extension)
    name: text().notNull(),
    // Extension without leading dot (e.g. 'pdf', 'md'). Null for dirs
    ext: text(),

    // ─── Tree structure ───
    // Parent entry ID. Null for mount root children (direct children of a mount)
    parentId: text(),
    // Mount this entry belongs to (FK → mount table, redundant for query performance)
    // Trashed entries keep their original mountId
    mountId: text()
      .notNull()
      .references(() => mountTable.id),

    // ─── File attributes ───
    // File size in bytes. Null for dirs
    size: integer(),

    // ─── Remote file fields (files under remote mounts) ───
    remoteId: text(),
    cachedAt: integer(),

    // ─── Trash ───
    // Non-null = trashed (ms epoch). Only set on the top-level trashed entry.
    // Child entries are implicitly trashed via tree traversal.
    trashedAt: integer(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    // Self-referencing FK: cascade delete children when parent is deleted
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('cascade'),
    // Indexes
    index('fe_parent_id_idx').on(t.parentId),
    index('fe_mount_id_idx').on(t.mountId),
    index('fe_mount_type_idx').on(t.mountId, t.type),
    index('fe_name_idx').on(t.name),
    index('fe_updated_at_idx').on(t.updatedAt),
    index('fe_trashed_at_idx').on(t.trashedAt),
    // ─── Type constraint ───
    check('fe_type_check', sql`${t.type} IN ('file', 'dir')`)
  ]
)

/**
 * File reference table - tracks which business entities reference which file entries
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
