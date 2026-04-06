import type { MountConfig } from '@shared/data/types/file'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * File entry table - unified file/directory/mount entry entity
 *
 * Uses adjacency list pattern (parentId) for tree navigation.
 * Mount entries (type='mount') serve as root entries with provider configuration.
 * Trash is a system mount entry (providerType='system') for OS-style soft deletion.
 */
export const fileEntryTable = sqliteTable(
  'file_entry',
  {
    id: uuidPrimaryKeyOrdered(),

    // ─── Core fields ───
    // Entry type: file | dir | mount
    type: text().notNull(),
    // User-visible name (without extension)
    name: text().notNull(),
    // Extension without leading dot (e.g. 'pdf', 'md'). Null for dirs/mounts
    ext: text(),

    // ─── Tree structure ───
    // Parent entry ID. Null for mount entries (top-level)
    parentId: text(),
    // Mount ID this entry belongs to (redundant for query performance). Mount entries: mountId = id
    // Entries in Trash keep their original mountId (pointing to the mount they belonged to before deletion)
    // Soft reference by design: no FK constraint because mount entries use well-known string IDs
    // (e.g. 'mount_files') that don't fit a standard FK pattern. Integrity is enforced at the
    // service layer. If a mount is ever removed, orphaned children must be cleaned up explicitly.
    mountId: text().notNull(),

    // ─── File attributes ───
    // File size in bytes. Null for dirs/mounts
    size: integer(),

    // ─── Mount-only fields (type='mount') ───
    // Provider configuration JSON, validated by MountConfigSchema
    mountConfig: text({ mode: 'json' }).$type<MountConfig>(),

    // ─── Remote file fields (files under remote mounts) ───
    // Remote file ID (e.g. OpenAI file-abc123)
    remoteId: text(),
    // When the local cache was last downloaded (ms epoch). Null if not cached.
    // Compare with remote updatedAt to detect staleness.
    cachedAt: integer(),

    // ─── Trash fields ───
    // Original parent ID before moving to Trash (only set on Trash direct children)
    previousParentId: text(),

    // ─── Timestamps ───
    // Uses createUpdateTimestamps (no deletedAt) intentionally.
    // Trash is modeled as a tree move to system_trash, not a soft-delete flag.
    // See: packages/shared/data/types/file/fileEntry.ts for the lifecycle state machine.
    ...createUpdateTimestamps
  },
  (t) => [
    // Self-referencing FK: cascade delete children when parent is deleted (Trash cleanup).
    // TODO(phase-2): Add hard-coded deletion protection for SYSTEM_ENTRY_IDS in the service
    // layer. Deleting a mount entry (e.g. mount_files) would cascade through the entire
    // subtree + all file_ref rows, bypassing the service layer. Service-layer delete handlers
    // must reject delete requests for SYSTEM_ENTRY_IDS to prevent accidental cascades.
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('cascade'),
    // Indexes
    index('fe_parent_id_idx').on(t.parentId),
    index('fe_mount_id_idx').on(t.mountId),
    index('fe_mount_type_idx').on(t.mountId, t.type),
    index('fe_name_idx').on(t.name),
    index('fe_updated_at_idx').on(t.updatedAt),
    // ─── Type constraint ───
    check('fe_type_check', sql`${t.type} IN ('file', 'dir', 'mount')`),
    // ─── Type invariant constraints (defense-in-depth, mirrors Zod superRefine) ───
    check('fe_mount_parent_null', sql`${t.type} != 'mount' OR ${t.parentId} IS NULL`),
    check('fe_mount_self_ref', sql`${t.type} != 'mount' OR ${t.mountId} = ${t.id}`),
    check('fe_mount_has_config', sql`${t.type} != 'mount' OR ${t.mountConfig} IS NOT NULL`), // column: mount_config
    check('fe_nonmount_has_parent', sql`${t.type} = 'mount' OR ${t.parentId} IS NOT NULL`),
    // Trash state biconditional: previousParentId is set IFF parentId = 'system_trash'
    check('fe_trash_state', sql`(${t.previousParentId} IS NULL) != (${t.parentId} = 'system_trash')`)
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
    // Free-form string validated by z.string().min(1). Semantic validation
    // (e.g. constraining to known source types) deferred to Phase 2 service layer.
    sourceType: text().notNull(),
    // Business object ID (polymorphic, no FK constraint)
    sourceId: text().notNull(),
    // Reference role (e.g. 'attachment', 'source', 'asset')
    role: text().notNull(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    // Look up references by file entry
    index('file_ref_entry_id_idx').on(t.fileEntryId),
    // Look up referenced files by business object
    index('file_ref_source_idx').on(t.sourceType, t.sourceId),
    // Prevent duplicate references (same file cannot be referenced by same business object with same role twice)
    uniqueIndex('file_ref_unique_idx').on(t.fileEntryId, t.sourceType, t.sourceId, t.role)
  ]
)
