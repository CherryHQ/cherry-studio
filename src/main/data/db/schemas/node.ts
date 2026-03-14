import type { MountProviderConfig } from '@shared/data/types/fileProvider'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Node table - unified file/directory/mount node entity
 *
 * Uses adjacency list pattern (parentId) for tree navigation.
 * Mount nodes (type='mount') serve as root nodes with provider configuration.
 * Trash is a system mount node (provider_type='system') for OS-style soft deletion.
 */
export const nodeTable = sqliteTable(
  'node',
  {
    id: uuidPrimaryKeyOrdered(),

    // ─── Core fields ───
    // Node type: file | dir | mount
    type: text().notNull(),
    // User-visible name (without extension)
    name: text().notNull(),
    // Extension without leading dot (e.g. 'pdf', 'md'). Null for dirs/mounts
    ext: text(),

    // ─── Tree structure ───
    // Parent node ID. Null for mount nodes (top-level)
    parentId: text(),
    // Mount ID this node belongs to (redundant for query performance). Mount nodes: mountId = id
    // Nodes in Trash keep their original mountId (pointing to the mount they belonged to before deletion)
    mountId: text().notNull(),

    // ─── File attributes ───
    // File size in bytes. Null for dirs/mounts
    size: integer(),

    // ─── Mount-only fields (type='mount') ───
    // Provider configuration JSON, validated by MountProviderConfigSchema
    providerConfig: text({ mode: 'json' }).$type<MountProviderConfig>(),
    // Whether the mount is read-only (remote sources may be read-only)
    isReadonly: integer({ mode: 'boolean' }).default(false),

    // ─── Remote file fields (files under remote mounts) ───
    // Remote file ID (e.g. OpenAI file-abc123)
    remoteId: text(),
    // Whether a local cache copy exists
    isCached: integer({ mode: 'boolean' }).default(false),

    // ─── Trash fields ───
    // Original parent ID before moving to Trash (only set on Trash direct children)
    previousParentId: text(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    // Self-referencing FK: cascade delete children when parent is deleted (Trash cleanup)
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('cascade'),
    // Indexes
    index('node_parent_id_idx').on(t.parentId),
    index('node_mount_id_idx').on(t.mountId),
    index('node_mount_type_idx').on(t.mountId, t.type),
    index('node_name_idx').on(t.name),
    index('node_updated_at_idx').on(t.updatedAt),
    // Type constraint
    check('node_type_check', sql`${t.type} IN ('file', 'dir', 'mount')`)
  ]
)

/**
 * File reference table - tracks which business entities reference which files
 *
 * Polymorphic association: sourceType + sourceId identify the referencing entity.
 * No FK constraint on sourceId (polymorphic). Application-layer cleanup required
 * when source entities are deleted.
 *
 * nodeId has CASCADE delete: removing a file node auto-removes its references.
 */
export const fileRefTable = sqliteTable(
  'file_ref',
  {
    id: uuidPrimaryKey(),

    // Referenced file node ID
    nodeId: text()
      .notNull()
      .references(() => nodeTable.id, { onDelete: 'cascade' }),

    // Business source type (e.g. 'chat_message', 'knowledge_item', 'painting', 'note')
    // Enum validated at application layer (Zod), no CHECK constraint
    sourceType: text().notNull(),
    // Business object ID (polymorphic, no FK constraint)
    sourceId: text().notNull(),
    // Reference role (e.g. 'attachment', 'source', 'asset')
    role: text().notNull(),

    // ─── Timestamps ───
    ...createUpdateTimestamps
  },
  (t) => [
    // Look up references by file node
    index('file_ref_node_id_idx').on(t.nodeId),
    // Look up referenced files by business object
    index('file_ref_source_idx').on(t.sourceType, t.sourceId),
    // Prevent duplicate references (same file cannot be referenced by same business object with same role twice)
    uniqueIndex('file_ref_unique_idx').on(t.nodeId, t.sourceType, t.sourceId, t.role)
  ]
)
