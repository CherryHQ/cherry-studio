/**
 * File entry entity types
 *
 * Zod schemas for runtime validation of FileEntry records.
 * FileEntry is a flat list of Cherry-managed files (no tree structure).
 *
 * `FileEntry` is a **discriminated union on `origin`**: each variant declares
 * only the fields it owns, so consumers narrow naturally on `origin` instead
 * of dancing around nullable columns. The DB row layer keeps every column
 * physically (see "DB row vs Business Object" below).
 *
 * - `internal`: Cherry owns the content, stored at `{userData}/Data/Files/{id}.{ext}`.
 *   `name` / `ext` / `size` are authoritative truth (kept in sync by atomic writes).
 * - `external`: Cherry only references a user-provided path (`externalPath`).
 *   `name` / `ext` are pure projections of `externalPath` (basename / extname) —
 *   stable as long as the reference itself is stable. The BO has **no `size`
 *   field** for external entries (consumers needing a live value call File IPC
 *   `getMetadata(id)`, which runs `fs.stat` on demand; see rationale below).
 *
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 * For file reference types, see `./ref/`.
 *
 * ## Field presence per variant
 *
 * | Field         | origin='internal'                  | origin='external'                              |
 * |---------------|------------------------------------|------------------------------------------------|
 * | `name`        | SoT (user renamable)               | derived from `externalPath` basename (stable)  |
 * | `ext`         | SoT                                | derived from `externalPath` extname (stable)   |
 * | `size`        | SoT (bytes, ≥ 0)                   | **absent** — live value via `getMetadata`      |
 * | `externalPath`| **absent**                         | non-null absolute path (canonical)             |
 * | `trashedAt`   | optional (present iff trashed)     | **absent** (external cannot be trashed)        |
 *
 * "Absent" means the field is not declared on that variant's schema at all —
 * `entry.size` is a type error on the external arm, not `null` you have to
 * defend against. The DB still carries every column (see "DB row vs Business
 * Object"), but those `null`s are stripped at the BO boundary.
 *
 * ## Why external has no `size`
 *
 * External files can change outside Cherry at any time (user edits, another app
 * overwrites, the file gets moved). Storing a snapshot here would create two
 * classes of bugs: (a) callers silently consuming stale values, (b) "refresh"
 * operations that merely move the staleness window. Dropping `size` from the
 * external BO forces consumers to make the freshness tradeoff explicit — either
 * they don't need it, or they call `getMetadata` for a live `fs.stat`. `name` /
 * `ext` stay on the variant because they are pure projections of `externalPath`
 * (which is the SoT) and therefore cannot drift while the entry exists; the
 * cost of recomputing `path.basename` on every row is not worth the
 * denormalization saving.
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
 * - Active:   `trashedAt` is absent — on `InternalEntrySchema` it's `optional`
 *             so omitted means live; `ExternalEntrySchema` doesn't declare the
 *             field at all and the DB `fe_external_no_trash` CHECK enforces it
 *             at the row layer
 * - Trashed:  `trashedAt = <ms epoch>` (internal-only)
 * - permanentDelete on internal: unlink FS file + delete DB row
 * - permanentDelete on external: **DB row only** — the physical file is left
 *   untouched. Entry-level deletion is decoupled from physical deletion;
 *   callers wanting to delete the file on disk should invoke the path-level
 *   unmanaged `@main/utils/file/fs.remove(path)` separately.
 */

import { canonicalizeAbsolutePath } from '@shared/file/canonicalize'
import type { FilePath } from '@shared/file/types/common'
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
export const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => !s.includes('\0'), 'externalPath must not contain null bytes')
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

/**
 * Intersection brand carried by the `externalPath` field on the FileEntry
 * BO: a string that is both **canonical** (provenance: passed through
 * `canonicalizeAbsolutePath` / `canonicalizeExternalPath`) and **satisfies
 * the `FilePath` template-literal shape** (so it can flow into any
 * `@main/utils/file/*` API without a cast).
 *
 * Round 2 S5: the schema's `externalPath` field used to be plain
 * `AbsolutePathSchema` (inferred as `string`), forcing five production
 * sites to `as FilePath`-cast at every read. The schema now `refine`s
 * against `canonicalizeAbsolutePath` (real runtime check; rejects any
 * non-canonical input at parse time) and then `transform`s the result
 * into this intersection — so consumers reading `entry.externalPath`
 * get a value typed exactly as they need it, with the canonical
 * provenance proven at the schema boundary.
 */
export type CanonicalFilePath = FilePath & CanonicalExternalPath

// ─── FileEntry Schema (discriminated union on origin, branded) ───
//
// ## DB row vs Business Object
//
// The `file_entry` SQLite table is a flat row with all columns physically
// present (size / externalPath / trashedAt are all nullable on the column
// level), guarded by three CHECK constraints (`fe_origin_consistency`,
// `fe_size_internal_only`, `fe_external_no_trash`) so a row can never
// represent an impossible combination. That is the **DB-row** layer.
//
// `FileEntry` is the **business object** consumers actually work with.
// Discrimination on `origin` means an internal entry doesn't *have* an
// `externalPath`, and an external entry doesn't *have* a `size` /
// `trashedAt` — these fields are simply absent on the BO shape, not `null`.
// Narrowing on `origin` gives TS the right keys at the right callsite,
// so renderer code never has to `if (entry.origin === 'internal') ...`
// just to access `entry.size`, and never has to `as` a `null` check away.
//
// `rowToFileEntry` is the translation layer: take a DB row, switch on
// `origin`, build the variant-specific plain object (dropping the null
// columns that don't belong on that variant), then run
// `FileEntrySchema.parse` to get the brand back. The DB CHECK constraints
// and the BO schema express the same invariants from two layers.

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

/**
 * Internal entry — Cherry owns the content at `{userData}/Data/Files/{id}.{ext}`.
 *
 * Variant-only fields: `size` (authoritative byte count), `trashedAt`
 * (optional, present and non-null when entry is trashed). `externalPath`
 * is absent on this variant — there is no user-provided path. The DB row
 * carries `externalPath: null` to satisfy the table schema; the BO
 * dispatcher drops it.
 */
export const InternalEntrySchema = z.strictObject({
  ...CommonEntryFields,
  origin: z.literal('internal'),
  /**
   * File size in bytes. Internal files are written atomically by Cherry, so
   * this value is authoritative and kept in sync with the backing file on disk.
   */
  size: z.int().nonnegative(),
  /**
   * Trash timestamp (ms epoch). Optional — present and non-null when the
   * entry is in the trash, absent when it is live. Internal entries are the
   * only ones that can be trashed (`fe_external_no_trash` CHECK).
   */
  trashedAt: TimestampSchema.optional()
})

/**
 * External entry — Cherry references a user-provided path.
 *
 * Variant-only field: `externalPath` (absolute, canonical). `size` and
 * `trashedAt` are absent on this variant — external files may change
 * outside Cherry at any time so no DB size snapshot is kept (live values
 * come from File IPC `getMetadata`), and external entries cannot be
 * trashed (`fe_external_no_trash` CHECK). The DB row carries `size: null`
 * and `trashedAt: null` to satisfy the table schema; the BO dispatcher
 * drops them.
 */
export const ExternalEntrySchema = z.strictObject({
  ...CommonEntryFields,
  origin: z.literal('external'),
  /**
   * Absolute filesystem path to the user-provided file. The schema runs a
   * **real** `canonicalize` equivalence check (not just a shape match): the
   * input must equal `canonicalizeAbsolutePath(input)`, otherwise parse
   * rejects. Combined with the `.transform` below, this means any value the
   * BO ever exposes is provably canonical AND carries the `FilePath` shape,
   * eliminating the five `as FilePath` casts that used to sit at every read
   * site (rename.ts, lifecycle.ts, danglingCache.ts, …).
   */
  externalPath: AbsolutePathSchema.refine((s) => {
    // canonicalizeAbsolutePath throws on structural failures (non-absolute,
    // contains \0) — both already surfaced by `AbsolutePathSchema`'s own
    // refines, but Zod does not short-circuit on prior refine failure, so we
    // must absorb the throw here. Failure → return false → schema rejects
    // with the canonicalization message (and the prior issue is also
    // reported, giving the caller the full picture).
    try {
      return s === canonicalizeAbsolutePath(s)
    } catch {
      return false
    }
  }, 'externalPath must be canonicalized via canonicalizeExternalPath() before persistence').transform(
    (s): CanonicalFilePath => s as CanonicalFilePath
  )
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
