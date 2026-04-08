/**
 * File entry entity types
 *
 * Zod schemas for runtime validation of file entries (file/dir) in the managed file tree.
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 * For file reference types, see `./ref/`.
 * For mount types, see `./provider.ts`.
 *
 * ## Entry type invariants
 *
 * | Field       | type=dir     | type=file              |
 * |-------------|--------------|------------------------|
 * | parentId    | non-null     | non-null               |
 * | mountId     | FK → mount   | FK → mount             |
 * | ext         | null         | string or null (null for extensionless files) |
 * | size        | null         | number or null         |
 * | remoteId    | nullable     | nullable               |
 * | cachedAt    | nullable     | nullable               |
 * | trashedAt   | nullable     | nullable               |
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
 * ### Trash state
 *
 * Trash is modeled via `trashedAt` timestamp:
 * - `trashedAt = null` → Active
 * - `trashedAt = <ms epoch>` → Trashed (only set on top-level trashed entry)
 * - `parentId` never changes during trash/restore
 * - Child entries are implicitly trashed via tree traversal
 */

import * as z from 'zod'

import { SafeNameSchema, TimestampSchema } from './essential'

// ─── Entry ID ───

/**
 * File entry ID: UUID v7.
 *
 * Note: `FileEntryId` is inferred as `string` at the type level — it does NOT carry
 * runtime validation. API handlers MUST validate incoming IDs with `FileEntryIdSchema.parse()`
 * to enforce the UUID v7 constraint.
 */
export const FileEntryIdSchema = z.uuidv7()
export type FileEntryId = z.infer<typeof FileEntryIdSchema>

// ─── Entry Type ───

export const FileEntryTypeSchema = z.enum(['file', 'dir'])
export type FileEntryType = z.infer<typeof FileEntryTypeSchema>

// ─── Common Fields ───

const entryCommonFields = {
  /** Entry ID (UUID v7) */
  id: FileEntryIdSchema,
  /** User-visible name (without extension) */
  name: SafeNameSchema,
  /**
   * Mount ID this entry belongs to (FK → mount table, UUID v7).
   */
  mountId: z.uuidv7(),
  /** Parent entry ID (UUID v7). Null for mount root children (direct children of a mount) */
  parentId: z.uuidv7().nullable(),
  /** Trash timestamp (ms epoch). Non-null = trashed. Only set on top-level trashed entry. */
  trashedAt: TimestampSchema.nullable(),
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
}

// ─── Per-Type Schemas ───

/** Directory entry */
export const DirEntrySchema = z.object({
  ...entryCommonFields,
  type: z.literal('dir'),
  ext: z.null(),
  size: z.null(),
  /** Remote directory ID (e.g. S3 folder key, Google Drive folder ID). Null for local mounts */
  remoteId: z.string().nullable(),
  /** When the local cache was last synced (ms epoch). Null for local mounts or if not cached */
  cachedAt: TimestampSchema.nullable()
})

/** Regular file entry (type='file') */
export const RegularFileEntrySchema = z.object({
  ...entryCommonFields,
  type: z.literal('file'),
  /** File extension without leading dot (e.g. 'pdf', 'md'). Null for extensionless files (e.g. Dockerfile) */
  ext: z.string().min(1).nullable(),
  /** File size in bytes */
  size: z.int().nonnegative().nullable(),
  /** Remote file ID (e.g. OpenAI file-abc123). Convention: validated at service layer (requires mount context) */
  remoteId: z.string().nullable(),
  /** When the local cache was last downloaded (ms epoch). Convention: validated at service layer */
  cachedAt: TimestampSchema.nullable()
})

// ─── Discriminated Union ───

/** Complete file entry entity as stored in database, discriminated by `type` */
export const FileEntrySchema = z.discriminatedUnion('type', [DirEntrySchema, RegularFileEntrySchema])
export type FileEntry = z.infer<typeof FileEntrySchema>

// ─── Per-Type Inferred Types ───

export type DirEntry = z.infer<typeof DirEntrySchema>
export type RegularFileEntry = z.infer<typeof RegularFileEntrySchema>

// ─── Type Guards ───

export function isDirEntry(entry: FileEntry): entry is DirEntry {
  return entry.type === 'dir'
}

export function isRegularFileEntry(entry: FileEntry): entry is RegularFileEntry {
  return entry.type === 'file'
}
