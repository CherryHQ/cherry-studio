/**
 * File entry entity types
 *
 * Zod schemas for runtime validation of FileEntry records.
 * FileEntry is a flat list of Cherry-managed files (no tree structure).
 *
 * Every entry has an `origin`:
 * - `internal`: Cherry owns the content, stored at `{userData}/Data/Files/{id}.{ext}`.
 *   `name` / `ext` / `size` are authoritative truth (kept in sync by atomic writes).
 * - `external`: Cherry only references a user-provided path (`externalPath`).
 *   `name` / `ext` are pure projections of `externalPath` (basename / extname) —
 *   stable as long as the reference itself is stable. `size` is **not stored**
 *   for external entries (`null`); consumers needing a live value call File IPC
 *   `getMetadata(id)` which runs `fs.stat` on demand.
 *
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 * For file reference types, see `./ref/`.
 *
 * ## Invariants
 *
 * | Field         | origin='internal'      | origin='external'                              |
 * |---------------|------------------------|------------------------------------------------|
 * | `name`        | SoT (user renamable)   | derived from `externalPath` basename (stable)  |
 * | `ext`         | SoT                    | derived from `externalPath` extname (stable)   |
 * | `size`        | SoT (bytes, ≥ 0)       | **always `null`** — live value via `getMetadata`|
 * | `externalPath`| null                   | non-null absolute path                         |
 * | `trashedAt`   | nullable               | **always null** (external cannot be trashed)   |
 *
 * ## Why `size` is null for external
 *
 * External files can change outside Cherry at any time (user edits, another app
 * overwrites, the file gets moved). Storing a snapshot here would create two
 * classes of bugs: (a) callers silently consuming stale values, (b) "refresh"
 * operations that merely move the staleness window. Making `size` unavailable
 * at the DB layer forces consumers to make the freshness tradeoff explicit —
 * either they don't need it, or they call `getMetadata` for a live `fs.stat`.
 * `name` / `ext` stay on the row because they are pure projections of
 * `externalPath` (which is the SoT) and therefore cannot drift while the entry
 * exists; the cost of recomputing `path.basename` on every row is not worth
 * the denormalization saving.
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
 *                         (update in place via rename / write)
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
 *   unmanaged `@main/utils/file/fs.remove(path)` separately.
 */

import * as z from 'zod'

import { SafeExtSchema, SafeNameSchema, TimestampSchema } from './essential'

// ─── Entry ID ───

/**
 * File entry ID: UUID. New entries created in v2 are v7 (auto-generated by
 * `uuidPrimaryKeyOrdered()` / `FileEntryService.create`); entries originating
 * from a legacy data path may be v4. The schema accepts any UUID version so
 * cross-table references can keep their original ids without a global remap.
 *
 * Note: `FileEntryId` is inferred as `string` at the type level — it does NOT
 * carry runtime validation. API handlers MUST validate incoming IDs with
 * `FileEntryIdSchema.parse()` to reject random / non-UUID strings.
 */
export const FileEntryIdSchema = z.uuid()
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
 * trailing-separator strip. Zod cannot enforce this shape
 * at the schema level; `ensureExternalEntry` and `fileEntryService.findByExternalPath`
 * are the application-layer enforcement points. See `pathResolver.ts` for
 * the full contract, including deliberately deferred normalization steps
 * (case-insensitive FS dedupe, symlink target resolution).
 */
const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('/') || /^[A-Za-z]:\\/.test(s), 'externalPath must be an absolute filesystem path')

// ─── Canonical External Path (TS phantom brand) ───

/**
 * A `string` already processed through `canonicalizeExternalPath`.
 *
 * This is a **TypeScript-only phantom brand** (zero runtime cost, zero wire
 * cost) that acts as a compile-time guard for every DB read/write surface on
 * `externalPath`: any query entry point that filters by `externalPath` MUST
 * narrow its input to this type, which forces callers through
 * `canonicalizeExternalPath()` instead of accepting a raw user path.
 *
 * ## Why a brand and not runtime validation
 *
 * The correctness invariant — "the string equals `canonicalizeExternalPath(x)`
 * for some `x`" — cannot be verified at runtime without re-running
 * canonicalization, which would defeat the purpose. The brand expresses
 * "this value was produced by the authorized factory" structurally, so the
 * type system (not runtime checks) enforces the contract.
 *
 * ## Authorized construction
 *
 * - **Production code**: only `canonicalizeExternalPath()` in
 *   `src/main/services/file/utils/pathResolver.ts` may produce values of this type.
 *   Other production code importing `CanonicalExternalPath` MUST receive it
 *   from that function (directly or transitively) — never via `as` cast.
 * - **Tests and fixtures**: may cast known-canonical string literals with
 *   `'/abs/path' as CanonicalExternalPath` for readability.
 * - **DB rows**: the `externalPath` column is typed as `string | null` in
 *   Drizzle (SQLite has no brand concept); upcasting into
 *   `CanonicalExternalPath` at the service boundary is acceptable because
 *   writes on that column already go through the canonicalization path.
 */
declare const canonicalExternalPathBrand: unique symbol
export type CanonicalExternalPath = string & { readonly [canonicalExternalPathBrand]: 'CanonicalExternalPath' }

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
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
} as const

/** origin='internal': Cherry owns the content. `externalPath` must be null. */
export const InternalEntrySchema = z.strictObject({
  ...CommonEntryFields,
  origin: z.literal('internal'),
  /**
   * File size in bytes. Internal files are written atomically by Cherry, so
   * this value is authoritative and kept in sync with the backing file on disk.
   */
  size: z.int().nonnegative(),
  /** Must be null for internal entries (physical storage is UUID-based in userData). */
  externalPath: z.null(),
  /** Trash timestamp (ms epoch). Non-null = trashed. Internal-only. */
  trashedAt: TimestampSchema.nullable()
})

/** origin='external': Cherry references a user-provided path. `externalPath` must be a non-null absolute path. */
export const ExternalEntrySchema = z.strictObject({
  ...CommonEntryFields,
  origin: z.literal('external'),
  /**
   * Always `null` for external entries. External files may change outside
   * Cherry at any time, so no DB-level size snapshot is stored. Consumers that
   * need a live value call File IPC `getMetadata(id)` which performs a single
   * `fs.stat`. Mirrors the `fe_size_internal_only` CHECK constraint at the DB
   * level.
   */
  size: z.null(),
  /** Absolute filesystem path to the user-provided file. */
  externalPath: AbsolutePathSchema,
  /**
   * External entries cannot be trashed; this is always `null`. Mirrors the
   * `fe_external_no_trash` CHECK constraint at the DB level. Removal is
   * always immediate via `permanentDelete` (DB-only — the physical file is
   * left untouched; path-level `@main/utils/file/fs.remove` is a separate, explicit call).
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
 * SQL-only boundary. See [file-manager-architecture.md §11](../../../../docs/references/file/file-manager-architecture.md).
 */
export const DanglingStateSchema = z.enum(['present', 'missing', 'unknown'])
export type DanglingState = z.infer<typeof DanglingStateSchema>
