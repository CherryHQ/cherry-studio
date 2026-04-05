/**
 * File tree node entity types
 *
 * Zod schemas for runtime validation of file nodes (file/dir/mount) in the unified tree.
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 * For file reference types, see `./ref/`.
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
 * | remoteId         | null                    | nullable (remote dirs have IDs) | nullable (validated at service layer) |
 * | cachedAt         | null                    | nullable (remote dirs have cache state) | nullable (validated at service layer) |
 * | previousParentId | null (mount can't be trashed) | nullable (trash state) | nullable (trash state) |
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

import { SafeNameSchema, TimestampSchema } from './essential'
import { MountProviderConfigSchema } from './provider'
import { tempSessionRefFields } from './ref'

// ─── System Node IDs ───

/** Well-known system mount node IDs, seeded at app initialization. */
export const SYSTEM_MOUNT_FILES = 'mount_files' as const
export const SYSTEM_MOUNT_NOTES = 'mount_notes' as const
export const SYSTEM_TEMP = 'system_temp' as const
export const SYSTEM_TRASH = 'system_trash' as const
export const SYSTEM_NODE_IDS = [SYSTEM_MOUNT_FILES, SYSTEM_MOUNT_NOTES, SYSTEM_TEMP, SYSTEM_TRASH] as const
export const SystemNodeIdSchema = z.enum(SYSTEM_NODE_IDS)
export type SystemNodeId = z.infer<typeof SystemNodeIdSchema>

/**
 * Accepts UUID v7 or a known system node ID.
 *
 * Note: `NodeId` is inferred as `string` at the type level — it does NOT carry
 * runtime validation. API handlers MUST validate incoming IDs with `NodeIdSchema.parse()`
 * to enforce the UUID v7 / system node ID constraint.
 */
export const NodeIdSchema = z.union([z.uuidv7(), SystemNodeIdSchema])
export type NodeId = z.infer<typeof NodeIdSchema>

// ─── Node Type ───

export const FileNodeTypeSchema = z.enum(['file', 'dir', 'mount'])
export type FileNodeType = z.infer<typeof FileNodeTypeSchema>

// ─── Common Fields ───

const nodeCommonFields = {
  /** Node ID (UUID v7, or a system node ID for mount nodes) */
  id: NodeIdSchema,
  /** User-visible name (without extension) */
  name: SafeNameSchema,
  /**
   * Mount ID this node belongs to. For mount nodes, equals own id.
   * Known system mounts: `mount_files`, `mount_notes`, `system_temp`, `system_trash`.
   */
  mountId: NodeIdSchema,
  /** Original parent ID before moving to Trash (only for Trash direct children) */
  previousParentId: NodeIdSchema.nullable(),
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
}

// ─── Per-Type Schemas ───

/** Mount node: top-level root with provider configuration */
export const MountNodeSchema = z
  .object({
    ...nodeCommonFields,
    type: z.literal('mount'),
    parentId: z.null(),
    // Mount nodes cannot be trashed — override to structurally forbid
    previousParentId: z.null(),
    ext: z.null(),
    size: z.null(),
    providerConfig: MountProviderConfigSchema,
    remoteId: z.null(),
    cachedAt: z.null()
  })
  .superRefine((node, ctx) => {
    if (node.mountId !== node.id) {
      ctx.addIssue({ code: 'custom', path: ['mountId'], message: 'Mount nodes must have mountId = own id' })
    }
  })

/** Directory node */
export const DirNodeSchema = z.object({
  ...nodeCommonFields,
  type: z.literal('dir'),
  parentId: NodeIdSchema,
  ext: z.null(),
  size: z.null(),
  providerConfig: z.null(),
  /** Remote directory ID (e.g. S3 folder key, Google Drive folder ID). Null for local mounts */
  remoteId: z.string().nullable(),
  /** When the local cache was last synced (ms epoch). Null for local mounts or if not cached */
  cachedAt: TimestampSchema.nullable()
})

/** File node */
export const FileNodeSchema = z.object({
  ...nodeCommonFields,
  type: z.literal('file'),
  parentId: NodeIdSchema,
  /** File extension without leading dot (e.g. 'pdf', 'md'). Null for extensionless files (e.g. Dockerfile) */
  ext: z.string().min(1).nullable(),
  /** File size in bytes */
  size: z.int().nonnegative().nullable(),
  providerConfig: z.null(),
  /** Remote file ID (e.g. OpenAI file-abc123). Convention: validated at service layer (requires mount context) */
  remoteId: z.string().nullable(),
  /** When the local cache was last downloaded (ms epoch). Convention: validated at service layer */
  cachedAt: TimestampSchema.nullable()
})

// ─── Discriminated Union ───

/** Complete file node entity as stored in database, discriminated by `type` */
export const FileTreeNodeSchema = z
  .discriminatedUnion('type', [MountNodeSchema, DirNodeSchema, FileNodeSchema])
  .superRefine((node, ctx) => {
    // ─── Trash state invariants (apply to all types) ───
    if (node.previousParentId !== null && node.parentId !== SYSTEM_TRASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['previousParentId'],
        message: 'previousParentId must only be set when parentId = system_trash'
      })
    }
    if (node.parentId === SYSTEM_TRASH && node.previousParentId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['previousParentId'],
        message: 'Trashed nodes must have previousParentId set for restore'
      })
    }
  })
export type FileTreeNode = z.infer<typeof FileTreeNodeSchema>

// ─── Per-Type Inferred Types ───

export type MountNode = z.infer<typeof MountNodeSchema>
export type DirNode = z.infer<typeof DirNodeSchema>
export type FileNode = z.infer<typeof FileNodeSchema>

// ─── Type Guards ───

export function isMountNode(node: FileTreeNode): node is MountNode {
  return node.type === 'mount'
}

export function isDirNode(node: FileTreeNode): node is DirNode {
  return node.type === 'dir'
}

export function isFileNode(node: FileTreeNode): node is FileNode {
  return node.type === 'file'
}

// ─── DTOs ───

/**
 * DTO for creating a new file or directory node.
 *
 * Internal to service layer — not exposed via DataApi.
 * FileManager IPC handlers use this when calling data/service after completing FS operations.
 *
 * - `name` — for files: full filename with extension (e.g. `report.pdf`),
 *            for dirs: directory name.
 *            Service layer splits file names into entity `name` + `ext`.
 *
 * Fields derived by the service layer (not in DTO):
 * - `mountId` — inherited from parent node
 * - `ext` — extracted from `name` for files
 * - `size` — read from actual file data
 */
export const CreateNodeDtoSchema = z.object({
  /** Node type (file or dir, not mount) */
  type: z.enum(['file', 'dir']),
  /** Full name: for files includes extension (e.g. `report.pdf`), for dirs the directory name */
  name: SafeNameSchema,
  /** Parent node ID (mountId is derived from this) */
  parentId: NodeIdSchema
})
export type CreateNodeDto = z.infer<typeof CreateNodeDtoSchema>

/**
 * DTO for updating a node's metadata.
 *
 * Internal to service layer — not exposed via DataApi.
 * `name` is the full name (with extension for files); service splits into `name` + `ext`.
 */
export const UpdateNodeDtoSchema = z.object({
  /** Updated full name (with extension for files) */
  name: SafeNameSchema.optional()
})
export type UpdateNodeDto = z.infer<typeof UpdateNodeDtoSchema>

/**
 * DTO for creating a file reference.
 *
 * Discriminated union on `sourceType` — each variant narrows `role` to valid
 * values for that source type, using the business fields from each ref variant.
 *
 * When adding a new FileRef variant, add its `*RefFields` here as well.
 */
export const CreateFileRefDtoSchema = z.discriminatedUnion('sourceType', [z.object(tempSessionRefFields)])
export type CreateFileRefDto = z.infer<typeof CreateFileRefDtoSchema>
