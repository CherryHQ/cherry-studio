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
 * | `trashedAt`   | nullable               | **always null** (external cannot be trashed) |
 *
 * ## Type safety: Zod brand on FileEntry
 *
 * `FileEntrySchema` is branded so arbitrary object literals cannot satisfy
 * the `FileEntry` type. Only values that have passed `FileEntrySchema.parse()`
 * (or `.safeParse()` with success) carry the brand. This forces entry
 * production through sanctioned paths (FileManager `createInternalEntry` /
 * `ensureExternalEntry` IPC, DataApi handler row→DTO conversion, FileMigrator
 * insert) which own the derivation of `name`/`ext`/`size`/etc.
 *
 * ## Lifecycle
 *
 * Internal entries:
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
 * External entries are monotonic — no Trashed state:
 *
 * ```
 *   ensureExternalEntry   ┌──────────┐   permanentDelete   ┌──────────┐
 *   ────────────────────→│  Active   │───────────────────→│ Deleted  │
 *                         └──────────┘                     └──────────┘
 *                         (update in place via rename / write / refreshMetadata)
 * ```
 *
 * - Active:   `trashedAt = null` (the only legal state for external; enforced
 *             by both Zod `z.null()` on `ExternalEntrySchema.trashedAt` and the
 *             DB `fe_external_no_trash` CHECK)
 * - Trashed:  `trashedAt = <ms epoch>` (internal-only)
 * - permanentDelete on internal: unlink FS file + delete DB row
 * - permanentDelete on external: **DB row only** — the physical file is left
 *   untouched. Entry-level deletion is decoupled from physical deletion;
 *   callers wanting to delete the file on disk should invoke the path-level
 *   unmanaged `ops.remove(path)` separately.
 */

import * as z from 'zod'

import { SafeExtSchema, SafeNameSchema, TimestampSchema } from './essential'

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

/**
 * Absolute filesystem path (Unix or Windows). Rejects `file://` URLs — use a
 * dedicated URL schema if needed.
 *
 * **Storage invariant for `externalPath`**: values persisted in
 * `file_entry.externalPath` must be the output of
 * `canonicalizeExternalPath()` — currently `path.resolve` + Unicode NFC +
 * trailing-separator strip (Phase 1b.1 scope). Zod cannot enforce this shape
 * at the schema level; `ensureExternalEntry` and `fileEntryService.findByExternalPath`
 * are the application-layer enforcement points. See `pathResolver.ts` for
 * the full contract, including deliberately deferred normalization steps
 * (case-insensitive FS dedupe, symlink target resolution).
 */
const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('/') || /^[A-Za-z]:\\/.test(s), 'externalPath must be an absolute filesystem path')

// ─── FileEntry Schema (discriminated union on origin, branded) ───

const CommonEntryFields = {
  /** Entry ID (UUID v7) */
  id: FileEntryIdSchema,
  /** User-visible name (without extension) */
  name: SafeNameSchema,
  /**
   * File extension without leading dot (e.g. `'pdf'`, `'md'`). `null` for
   * extensionless files (e.g. Dockerfile).
   *
   * Runtime validation is centralized in `SafeExtSchema`: no leading dot, no
   * path separators, no null bytes, no whitespace-only value. The TS type
   * stays plain `string | null` (no brand); correctness is enforced at system
   * boundaries (IPC parse, DB row parse, factory `splitName`) rather than at
   * every assignment site. `FileEntrySchema.parse` is the authoritative check.
   */
  ext: SafeExtSchema.nullable(),
  /** File size in bytes. For external, this is the last-observed snapshot. */
  size: z.int().nonnegative(),
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
} as const

/** origin='internal': Cherry owns the content. `externalPath` must be null. */
export const InternalEntrySchema = z.object({
  ...CommonEntryFields,
  origin: z.literal('internal'),
  /** Must be null for internal entries (physical storage is UUID-based in userData). */
  externalPath: z.null(),
  /** Trash timestamp (ms epoch). Non-null = trashed. Internal-only. */
  trashedAt: TimestampSchema.nullable()
})

/** origin='external': Cherry references a user-provided path. `externalPath` must be a non-null absolute path. */
export const ExternalEntrySchema = z.object({
  ...CommonEntryFields,
  origin: z.literal('external'),
  /** Absolute filesystem path to the user-provided file. */
  externalPath: AbsolutePathSchema,
  /**
   * External entries cannot be trashed; this is always `null`. Mirrors the
   * `fe_external_no_trash` CHECK constraint at the DB level. Removal is
   * always immediate via `permanentDelete` (DB-only — the physical file is
   * left untouched; path-level `ops.remove` is a separate, explicit call).
   */
  trashedAt: z.null()
})

/**
 * FileEntry schema (discriminated on `origin`, branded).
 *
 * Branding: only values produced by `FileEntrySchema.parse(raw)` satisfy the
 * `FileEntry` type. This prevents duck-typed object literals from being
 * assigned to `FileEntry`, forcing all entry production through sanctioned
 * code paths (see file-level docstring).
 */
export const FileEntrySchema = z
  .discriminatedUnion('origin', [InternalEntrySchema, ExternalEntrySchema])
  .brand<'FileEntry'>()

export type FileEntry = z.infer<typeof FileEntrySchema>
export type InternalFileEntry = z.infer<typeof InternalEntrySchema>
export type ExternalFileEntry = z.infer<typeof ExternalEntrySchema>

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
 * Not persisted in DB. Queried at runtime via File IPC
 * `getDanglingState` / `batchGetDanglingStates` — DataApi never exposes dangling
 * because it requires FS IO (cold-path `fs.stat`) which violates the DataApi
 * SQL-only boundary. See [file-manager-architecture.md](../../../../docs/zh/references/file/file-manager-architecture.md#11-dangling-detection).
 */
export const DanglingStateSchema = z.enum(['present', 'missing', 'unknown'])
export type DanglingState = z.infer<typeof DanglingStateSchema>
