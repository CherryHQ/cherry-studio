/**
 * File node and file reference entity types
 *
 * Zod schemas for runtime validation of file nodes and references.
 * FileNode represents a unified file/directory/mount node in the file tree.
 * FileRef tracks which business entities reference which file nodes.
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 *
 * ## Node type invariants
 *
 * | Field            | type=mount              | type=dir     | type=file              |
 * |------------------|-------------------------|--------------|------------------------|
 * | parentId         | null                    | non-null     | non-null               |
 * | mountId          | equals own `id`         | inherited    | inherited              |
 * | providerConfig   | non-null                | null         | null                   |
 * | ext              | null                    | null         | string or null (null for extensionless files) |
 * | size             | null                    | null         | number or null         |
 * | remoteId         | null                    | null         | set under remote mount |
 * | isCached         | false                   | false        | set under remote mount |
 *
 * ## Node lifecycle state machine
 *
 * ```
 *                  ┌──────────┐
 *        ┌────────│  Active   │←───────┐
 *        │        └────┬─────┘        │
 *        │             │ trash()      │ restore()
 *        │             ▼              │
 *        │        ┌──────────┐        │
 *        │        │ Trashed  │────────┘
 *        │        └────┬─────┘
 *        │             │ permanentDelete()
 *        │             ▼
 *        │        ┌──────────┐
 *        └───────→│ Deleted  │
 *  permanentDelete└──────────┘
 * ```
 *
 * ### State-dependent field constraints
 *
 * | Field           | Active                  | Trashed (direct child of Trash)  |
 * |-----------------|-------------------------|----------------------------------|
 * | parentId        | points to parent node   | `system_trash`                   |
 * | previousParentId| null                    | original parentId before trash   |
 * | mountId         | unchanged               | unchanged (keeps original mount) |
 *
 * Note: Nested children of a trashed node remain in "Active" shape — only the
 * top-level trashed node gets `parentId=system_trash` and `previousParentId` set.
 */

import * as z from 'zod'

import { MountProviderConfigSchema } from './fileProvider'

// ─── System Node IDs ───

/** Well-known system mount node IDs, created at app initialization */
export const SYSTEM_MOUNT_FILES = 'mount_files' as const
export const SYSTEM_MOUNT_NOTES = 'mount_notes' as const
export const SYSTEM_TRASH = 'system_trash' as const
export const SYSTEM_NODE_IDS = [SYSTEM_MOUNT_FILES, SYSTEM_MOUNT_NOTES, SYSTEM_TRASH] as const
export const SystemNodeIdSchema = z.enum(SYSTEM_NODE_IDS)
export type SystemNodeId = z.infer<typeof SystemNodeIdSchema>

/** Accepts UUID v7 or a known system node ID */
export const NodeIdSchema = z.union([z.uuidv7(), SystemNodeIdSchema])

// ─── Node Type ───

export const FileNodeTypeSchema = z.enum(['file', 'dir', 'mount'])
export type FileNodeType = z.infer<typeof FileNodeTypeSchema>

// ─── Entity Types ───

/** Complete file node entity as stored in database */
export const FileNodeSchema = z
  .object({
    /** Node ID (UUID v7, or a system node ID for mount nodes) */
    id: NodeIdSchema,
    /** Node type */
    type: FileNodeTypeSchema,
    /** User-visible name (without extension) */
    name: z.string().min(1),
    /** File extension without leading dot (e.g. 'pdf', 'md'). Null for dirs/mounts or extensionless files (e.g. Dockerfile) */
    ext: z.string().min(1).nullable(),
    /** Parent node ID. Null for mount nodes (top-level) */
    parentId: NodeIdSchema.nullable(),
    /**
     * Mount ID this node belongs to. For mount nodes, equals own id.
     * Known system mounts: `mount_files`, `mount_notes`, `system_trash`.
     * Can also be a dynamic ID for user-added remote mounts.
     */
    mountId: NodeIdSchema,
    /** File size in bytes. Null for dirs/mounts */
    size: z.int().nonnegative().nullable(),
    /** Provider config JSON (only for mount nodes) */
    providerConfig: MountProviderConfigSchema.nullable(),
    /** Whether the node is read-only */
    isReadonly: z.boolean(),
    /** Remote file ID (e.g. OpenAI file-abc123) */
    remoteId: z.string().nullable(),
    /** Whether a local cache copy exists */
    isCached: z.boolean(),
    /** Original parent ID before moving to Trash (only for Trash direct children) */
    previousParentId: NodeIdSchema.nullable(),
    /** Creation timestamp (ms epoch) */
    createdAt: z.int(),
    /** Last update timestamp (ms epoch) */
    updatedAt: z.int()
  })
  .superRefine((node, ctx) => {
    // ─── Type invariants ───
    switch (node.type) {
      case 'mount':
        if (node.parentId !== null) {
          ctx.addIssue({ code: 'custom', path: ['parentId'], message: 'Mount nodes must have parentId = null' })
        }
        if (node.mountId !== node.id) {
          ctx.addIssue({ code: 'custom', path: ['mountId'], message: 'Mount nodes must have mountId = own id' })
        }
        if (node.providerConfig === null) {
          ctx.addIssue({ code: 'custom', path: ['providerConfig'], message: 'Mount nodes must have providerConfig' })
        }
        if (node.ext !== null) {
          ctx.addIssue({ code: 'custom', path: ['ext'], message: 'Mount nodes must not have ext' })
        }
        if (node.size !== null) {
          ctx.addIssue({ code: 'custom', path: ['size'], message: 'Mount nodes must not have size' })
        }
        if (node.remoteId !== null) {
          ctx.addIssue({ code: 'custom', path: ['remoteId'], message: 'Mount nodes must not have remoteId' })
        }
        if (node.isCached !== false) {
          ctx.addIssue({ code: 'custom', path: ['isCached'], message: 'Mount nodes must have isCached = false' })
        }
        break
      case 'dir':
        if (node.parentId === null) {
          ctx.addIssue({ code: 'custom', path: ['parentId'], message: 'Dir nodes must have a parentId' })
        }
        if (node.providerConfig !== null) {
          ctx.addIssue({ code: 'custom', path: ['providerConfig'], message: 'Dir nodes must not have providerConfig' })
        }
        if (node.ext !== null) {
          ctx.addIssue({ code: 'custom', path: ['ext'], message: 'Dir nodes must not have ext' })
        }
        if (node.size !== null) {
          ctx.addIssue({ code: 'custom', path: ['size'], message: 'Dir nodes must not have size' })
        }
        if (node.remoteId !== null) {
          ctx.addIssue({ code: 'custom', path: ['remoteId'], message: 'Dir nodes must not have remoteId' })
        }
        if (node.isCached !== false) {
          ctx.addIssue({ code: 'custom', path: ['isCached'], message: 'Dir nodes must have isCached = false' })
        }
        break
      case 'file':
        if (node.parentId === null) {
          ctx.addIssue({ code: 'custom', path: ['parentId'], message: 'File nodes must have a parentId' })
        }
        if (node.providerConfig !== null) {
          ctx.addIssue({ code: 'custom', path: ['providerConfig'], message: 'File nodes must not have providerConfig' })
        }
        break
    }

    // ─── Trash state invariants ───
    if (node.previousParentId !== null && node.parentId !== SYSTEM_TRASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['previousParentId'],
        message: 'previousParentId must only be set when parentId = system_trash'
      })
    }
  })
export type FileNode = z.infer<typeof FileNodeSchema>

/** File reference entity — tracks business entity to file node relationships */
export const FileRefSchema = z.object({
  /** Reference ID (UUID v4) */
  id: z.uuidv4(),
  /** Referenced file node ID */
  nodeId: z.uuidv7(),
  /** Business source type (e.g. 'chat_message', 'knowledge_item', 'painting') */
  sourceType: z.string().min(1),
  /** Business object ID (polymorphic, no FK constraint) */
  sourceId: z.string().min(1),
  /** Reference role (e.g. 'attachment', 'source', 'asset') */
  role: z.string().min(1),
  /** Creation timestamp (ms epoch) */
  createdAt: z.int(),
  /** Last update timestamp (ms epoch) */
  updatedAt: z.int()
})
export type FileRef = z.infer<typeof FileRefSchema>

// ─── DTOs ───

/** DTO for creating a new file or directory node */
export const CreateNodeDtoSchema = z.object({
  /** Node type (file or dir, not mount) */
  type: z.enum(['file', 'dir']),
  /** User-visible name */
  name: z.string().min(1),
  /** File extension without leading dot */
  ext: z.string().min(1).optional(),
  /** Parent node ID */
  parentId: NodeIdSchema,
  /** Mount ID */
  mountId: NodeIdSchema,
  /** File size in bytes */
  size: z.int().nonnegative().optional()
})
export type CreateNodeDto = z.infer<typeof CreateNodeDtoSchema>

/** DTO for updating a node's metadata */
export const UpdateNodeDtoSchema = z.object({
  /** Updated name */
  name: z.string().min(1).optional(),
  /** Updated extension */
  ext: z.string().min(1).optional()
})
export type UpdateNodeDto = z.infer<typeof UpdateNodeDtoSchema>

/** DTO for creating a file reference */
export const CreateFileRefDtoSchema = z.object({
  /** Business source type */
  sourceType: z.string().min(1),
  /** Business object ID */
  sourceId: z.string().min(1),
  /** Reference role */
  role: z.string().min(1)
})
export type CreateFileRefDto = z.infer<typeof CreateFileRefDtoSchema>
