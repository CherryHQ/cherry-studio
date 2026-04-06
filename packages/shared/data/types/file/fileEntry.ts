/**
 * File entry entity types
 *
 * Zod schemas for runtime validation of file entries (file/dir/mount) in the unified tree.
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 * For file reference types, see `./ref/`.
 *
 * ## Entry type invariants
 *
 * | Field            | type=mount              | type=dir     | type=file              |
 * |------------------|-------------------------|--------------|------------------------|
 * | parentId         | null                    | non-null     | non-null               |
 * | mountId          | equals own `id`         | inherited    | inherited              |
 * | mountConfig   | non-null                | null         | null                   |
 * | ext              | null                    | null         | string or null (null for extensionless files) |
 * | size             | null                    | null         | number or null         |
 * | remoteId         | null                    | nullable (remote dirs have IDs) | nullable (validated at service layer) |
 * | cachedAt         | null                    | nullable (remote dirs have cache state) | nullable (validated at service layer) |
 * | previousParentId | null (mount can't be trashed) | nullable (trash state) | nullable (trash state) |
 *
 * ## Entry lifecycle state machine
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
 * | parentId        | points to parent entry  | `system_trash`                   |
 * | previousParentId| null                    | original parentId before trash   |
 * | mountId         | unchanged               | unchanged (keeps original mount) |
 *
 * Note: Nested children of a trashed entry remain in "Active" shape — only the
 * top-level trashed entry gets `parentId=system_trash` and `previousParentId` set.
 */

import * as z from 'zod'

import { SafeNameSchema, TimestampSchema } from './essential'
import { MountConfigSchema } from './provider'

// ─── System Entry IDs ───

/** Well-known system mount entry IDs, seeded at app initialization. */
export const SYSTEM_MOUNT_FILES = 'mount_files' as const
export const SYSTEM_MOUNT_NOTES = 'mount_notes' as const
export const SYSTEM_MOUNT_TEMP = 'mount_temp' as const
export const SYSTEM_TRASH = 'system_trash' as const
export const SYSTEM_ENTRY_IDS = [SYSTEM_MOUNT_FILES, SYSTEM_MOUNT_NOTES, SYSTEM_MOUNT_TEMP, SYSTEM_TRASH] as const
export const SystemEntryIdSchema = z.enum(SYSTEM_ENTRY_IDS)
export type SystemEntryId = z.infer<typeof SystemEntryIdSchema>

/**
 * Accepts UUID v7 or a known system entry ID.
 *
 * Note: `FileEntryId` is inferred as `string` at the type level — it does NOT carry
 * runtime validation. API handlers MUST validate incoming IDs with `FileEntryIdSchema.parse()`
 * to enforce the UUID v7 / system entry ID constraint.
 */
export const FileEntryIdSchema = z.union([z.uuidv7(), SystemEntryIdSchema])
export type FileEntryId = z.infer<typeof FileEntryIdSchema>

// ─── Entry Type ───

export const FileEntryTypeSchema = z.enum(['file', 'dir', 'mount'])
export type FileEntryType = z.infer<typeof FileEntryTypeSchema>

// ─── Common Fields ───

const entryCommonFields = {
  /** Entry ID (UUID v7, or a system entry ID for mount entries) */
  id: FileEntryIdSchema,
  /** User-visible name (without extension) */
  name: SafeNameSchema,
  /**
   * Mount ID this entry belongs to. For mount entries, equals own id.
   * Known system mounts: `mount_files`, `mount_notes`, `mount_temp`, `system_trash`.
   */
  mountId: FileEntryIdSchema,
  /** Original parent ID before moving to Trash (only for Trash direct children) */
  previousParentId: FileEntryIdSchema.nullable(),
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
}

// ─── Per-Type Schemas ───

/** Mount entry: top-level root with provider configuration */
export const MountEntrySchema = z
  .object({
    ...entryCommonFields,
    type: z.literal('mount'),
    parentId: z.null(),
    // Mount entries cannot be trashed — override to structurally forbid
    previousParentId: z.null(),
    ext: z.null(),
    size: z.null(),
    mountConfig: MountConfigSchema,
    remoteId: z.null(),
    cachedAt: z.null()
  })
  .superRefine((entry, ctx) => {
    if (entry.mountId !== entry.id) {
      ctx.addIssue({ code: 'custom', path: ['mountId'], message: 'Mount entries must have mountId = own id' })
    }
  })

/** Directory entry */
export const DirEntrySchema = z.object({
  ...entryCommonFields,
  type: z.literal('dir'),
  parentId: FileEntryIdSchema,
  ext: z.null(),
  size: z.null(),
  mountConfig: z.null(),
  /** Remote directory ID (e.g. S3 folder key, Google Drive folder ID). Null for local mounts */
  remoteId: z.string().nullable(),
  /** When the local cache was last synced (ms epoch). Null for local mounts or if not cached */
  cachedAt: TimestampSchema.nullable()
})

/** Regular file entry (type='file') */
export const RegularFileEntrySchema = z.object({
  ...entryCommonFields,
  type: z.literal('file'),
  parentId: FileEntryIdSchema,
  /** File extension without leading dot (e.g. 'pdf', 'md'). Null for extensionless files (e.g. Dockerfile) */
  ext: z.string().min(1).nullable(),
  /** File size in bytes */
  size: z.int().nonnegative().nullable(),
  mountConfig: z.null(),
  /** Remote file ID (e.g. OpenAI file-abc123). Convention: validated at service layer (requires mount context) */
  remoteId: z.string().nullable(),
  /** When the local cache was last downloaded (ms epoch). Convention: validated at service layer */
  cachedAt: TimestampSchema.nullable()
})

// ─── Discriminated Union ───

/** Complete file entry entity as stored in database, discriminated by `type` */
export const FileEntrySchema = z
  .discriminatedUnion('type', [MountEntrySchema, DirEntrySchema, RegularFileEntrySchema])
  .superRefine((entry, ctx) => {
    // ─── Trash state invariants (apply to all types) ───
    if (entry.previousParentId !== null && entry.parentId !== SYSTEM_TRASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['previousParentId'],
        message: 'previousParentId must only be set when parentId = system_trash'
      })
    }
    if (entry.parentId === SYSTEM_TRASH && entry.previousParentId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['previousParentId'],
        message: 'Trashed entries must have previousParentId set for restore'
      })
    }
  })
export type FileEntry = z.infer<typeof FileEntrySchema>

// ─── Per-Type Inferred Types ───

export type MountEntry = z.infer<typeof MountEntrySchema>
export type DirEntry = z.infer<typeof DirEntrySchema>
export type RegularFileEntry = z.infer<typeof RegularFileEntrySchema>

// ─── Type Guards ───

export function isMountEntry(entry: FileEntry): entry is MountEntry {
  return entry.type === 'mount'
}

export function isDirEntry(entry: FileEntry): entry is DirEntry {
  return entry.type === 'dir'
}

export function isRegularFileEntry(entry: FileEntry): entry is RegularFileEntry {
  return entry.type === 'file'
}
