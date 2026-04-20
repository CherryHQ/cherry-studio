/**
 * File entry entity types
 *
 * Zod schemas for runtime validation of FileEntry records.
 * FileEntry is a flat list of Cherry-managed files (no tree structure).
 *
 * Every entry has an `origin`:
 * - `internal`: Cherry owns the content, stored at `{userData}/files/{id}.{ext}`.
 *   `name/ext/size` are authoritative truth.
 * - `external`: Cherry only references a user-provided path (`externalPath`).
 *   `name/ext/size` are last-observed snapshots, refreshed on critical paths
 *   (read / hash / upload) or via explicit `refreshMetadata`.
 *
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 * For file reference types, see `./ref/`.
 *
 * ## Invariants
 *
 * | Field         | origin='internal'      | origin='external'                    |
 * |---------------|------------------------|--------------------------------------|
 * | `name`        | SoT (user renamable)   | derived from `externalPath` basename |
 * | `ext`         | SoT                    | derived from `externalPath`          |
 * | `size`        | SoT                    | last-observed snapshot               |
 * | `externalPath`| null                   | non-null absolute path               |
 * | `trashedAt`   | nullable               | nullable                             |
 *
 * ## Lifecycle
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
 * - Active:   `trashedAt = null`
 * - Trashed:  `trashedAt = <ms epoch>`
 * - permanentDelete on internal: unlink FS file + delete DB row
 * - permanentDelete on external: delete DB row only (user's file untouched)
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

// ─── Origin Enum ───

export const FileEntryOriginSchema = z.enum(['internal', 'external'])
export type FileEntryOrigin = z.infer<typeof FileEntryOriginSchema>

// ─── Absolute Path ───

/** Absolute filesystem path (Unix or Windows) */
const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('/') || /^[A-Za-z]:\\/.test(s), 'externalPath must be an absolute path')

// ─── FileEntry Schema ───

export const FileEntrySchema = z
  .object({
    /** Entry ID (UUID v7) */
    id: FileEntryIdSchema,
    /** Content ownership: 'internal' (Cherry-owned) | 'external' (user-owned, referenced only) */
    origin: FileEntryOriginSchema,
    /** User-visible name (without extension) */
    name: SafeNameSchema,
    /** File extension without leading dot (e.g. 'pdf', 'md'). Null for extensionless files */
    ext: z.string().min(1).nullable(),
    /** File size in bytes. For external, this is the last-observed snapshot. */
    size: z.int().nonnegative(),
    /** Absolute path to user-provided file. Non-null iff origin='external'. */
    externalPath: AbsolutePathSchema.nullable(),
    /** Trash timestamp (ms epoch). Non-null = trashed. */
    trashedAt: TimestampSchema.nullable(),
    /** Creation timestamp (ms epoch) */
    createdAt: TimestampSchema,
    /** Last update timestamp (ms epoch) */
    updatedAt: TimestampSchema
  })
  .superRefine((entry, ctx) => {
    if (entry.origin === 'internal' && entry.externalPath !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['externalPath'],
        message: 'internal entry must have null externalPath'
      })
    }
    if (entry.origin === 'external' && entry.externalPath === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['externalPath'],
        message: 'external entry must have non-null externalPath'
      })
    }
  })

export type FileEntry = z.infer<typeof FileEntrySchema>

// ─── Dangling State (presence of the backing file) ───

/**
 * External entry presence state, tracked by file_module's DanglingCache.
 *
 * - `'present'`: recently observed to exist (watcher event / successful stat / ops observation)
 * - `'missing'`: recently observed to be absent (watcher unlink / stat ENOENT)
 * - `'unknown'`: no watcher coverage and no recent stat — cache miss
 *
 * Internal entries are always `'present'`.
 *
 * Not persisted in DB. Computed at query time when DataApi caller passes
 * `includeDangling: true`. See `file-manager-architecture.md §11`.
 */
export const DanglingStateSchema = z.enum(['present', 'missing', 'unknown'])
export type DanglingState = z.infer<typeof DanglingStateSchema>
