/**
 * File-domain data types — the cross-process shapes for Cherry-managed files.
 *
 * Three cohesive sections, all keyed off `FileEntry`:
 * - **FileEntry** — the managed-file entity (this section).
 * - **FileHandle** — a call-site reference to a file, by entry-id or raw path.
 * - **FileRef** — the association linking a business entity (chat message,
 *   painting, temp session) to a `FileEntry`.
 *
 * The legacy v1 `FileMetadata` shape lives separately in `./legacyFile.ts`.
 *
 * ## FileEntry
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
 * For file reference types, see `./fileRef.ts`.
 *
 * ## Field presence per variant
 *
 * | Field         | origin='internal'                  | origin='external'                              |
 * |---------------|------------------------------------|------------------------------------------------|
 * | `name`        | SoT (user renamable)               | derived from `externalPath` basename (stable)  |
 * | `ext`         | SoT                                | derived from `externalPath` extname (stable)   |
 * | `size`        | SoT (bytes, ≥ 0)                   | **absent** — live value via `getMetadata`      |
 * | `externalPath`| **absent**                         | non-null absolute path (canonical)             |
 * | `deletedAt`   | optional (present iff trashed)     | **absent** (external cannot be trashed)        |
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
 * - Active:   `deletedAt` is absent — on `InternalEntrySchema` it's `optional`
 *             so omitted means live; `ExternalEntrySchema` doesn't declare the
 *             field at all and the DB `fe_external_no_delete` CHECK enforces it
 *             at the row layer
 * - Trashed:  `deletedAt = <ms epoch>` (internal-only)
 * - permanentDelete on internal: unlink FS file + delete DB row
 * - permanentDelete on external: **DB row only** — the physical file is left
 *   untouched. Entry-level deletion is decoupled from physical deletion;
 *   callers wanting to delete the file on disk should invoke the path-level
 *   unmanaged `@main/utils/file/fs.remove(path)` separately.
 */

import { type FilePath, SafeExtSchema } from '@shared/types/file'
import { canonicalizeAbsolutePath } from '@shared/utils/file'
import * as z from 'zod'

import { MessageIdSchema } from './message'

// ─── Shared building blocks (timestamp + safe name) ───

/** Millisecond epoch timestamp (non-negative integer) */
export const TimestampSchema = z.int().nonnegative()

/**
 * Name schema with security validations.
 *
 * Threat model: names flow from user input or external snapshots into FS path
 * composition (`{dir}/{name}.{ext}`) and can be passed to `fs.*` syscalls.
 * Without sanitization, a caller-controlled name could:
 *   - `..` / `../...` → traverse out of the intended directory
 *   - `a/b` / `a\\b`  → redirect writes to an unintended subdirectory
 *   - `\0`            → truncate C-string APIs mid-path (classic null-byte bypass)
 *   - `'   '`         → produce empty-looking files that break UX and tooling
 *
 * This schema rejects all of the above. The ≤255-byte cap matches the strictest
 * common FS limit (ext4/HFS+/NTFS path segments).
 */
export const SafeNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.includes('\0'), 'Name must not contain null bytes')
  .refine((s) => !/[/\\]/.test(s), 'Name must not contain path separators')
  .refine((s) => !/^\.\.?$/.test(s), 'Name must not be . or ..')
  .refine((s) => s.trim().length > 0, 'Name must not be all whitespace')

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
// String-literal brand rather than a `unique symbol`: a `unique symbol` brand
// (named or inline) is inaccessible when TS emits a large inferred aggregate
// type that transitively embeds it (e.g. preload's
// `export type WindowApiType = typeof api`, via `FileEntry.externalPath`),
// triggering TS2527/TS4023. A literal-keyed brand is fully nameable across
// modules, so it dodges that while keeping the nominal identity — a plain
// `string` still lacks the property, so the value can only be produced by the
// canonicalization path or an explicit `as` cast, exactly as documented above.
export type CanonicalExternalPath = string & { readonly __brand: 'CanonicalExternalPath' }

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
// present (size / externalPath / deletedAt are all nullable on the column
// level), guarded by three CHECK constraints (`fe_origin_consistency`,
// `fe_size_internal_only`, `fe_external_no_delete`) so a row can never
// represent an impossible combination. That is the **DB-row** layer.
//
// `FileEntry` is the **business object** consumers actually work with.
// Discrimination on `origin` means an internal entry doesn't *have* an
// `externalPath`, and an external entry doesn't *have* a `size` /
// `deletedAt` — these fields are simply absent on the BO shape, not `null`.
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
   * Runtime validation is centralized in `SafeExtSchema`: no dots, no
   * whitespace, no path separators, and no null bytes. The TS type
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
 * Variant-only fields: `size` (authoritative byte count), `deletedAt`
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
   * only ones that can be trashed (`fe_external_no_delete` CHECK).
   */
  deletedAt: TimestampSchema.optional()
})

/**
 * External entry — Cherry references a user-provided path.
 *
 * Variant-only field: `externalPath` (absolute, canonical). `size` and
 * `deletedAt` are absent on this variant — external files may change
 * outside Cherry at any time so no DB size snapshot is kept (live values
 * come from File IPC `getMetadata`), and external entries cannot be
 * trashed (`fe_external_no_delete` CHECK). The DB row carries `size: null`
 * and `deletedAt: null` to satisfy the table schema; the BO dispatcher
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

// ═══════════════════════════════════════════════════════════════════════════
// FileHandle — call-site reference to a file (by entry-id or raw path)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FileHandle — unified reference to any file accessible by Cherry.
 *
 * A handle is a **call-site choice of reference form**, not a statement about
 * the file's ownership or registration status:
 * - `FileEntryHandle` carries a `FileEntryId` — the call goes through the entry
 *   system (FileManager, versionCache, DanglingCache, …).
 * - `FilePathHandle` carries an absolute `FilePath` — the call bypasses the
 *   entry system and hits `@main/utils/file/*` directly.
 *
 * The same physical file can be referenced by either form (with different
 * side-effect semantics). Distinct from `FileRef` below (the association shape).
 *
 * The runtime factories and type guards (`createFilePathHandle`,
 * `isFilePathHandle`, …) live in `@shared/utils/file` — this section owns only
 * the handle shapes and their IPC-boundary schemas.
 */

export type FileEntryHandle = {
  readonly kind: 'entry'
  readonly entryId: FileEntryId
}

export type FilePathHandle = {
  readonly kind: 'path'
  readonly path: FilePath
}

export type FileHandle = FileEntryHandle | FilePathHandle

/**
 * Zod schemas for `FileHandle`, used to validate IPC payloads at the main-process
 * boundary. The runtime factories `createFileEntryHandle` / `createFilePathHandle`
 * (in `@shared/utils/file`) are for in-process construction; these schemas are
 * the gate for untrusted input crossing the IPC seam.
 */
export const FileEntryHandleSchema = z.strictObject({
  kind: z.literal('entry'),
  entryId: FileEntryIdSchema
})

export const FilePathHandleSchema = z.strictObject({
  kind: z.literal('path'),
  path: AbsolutePathSchema
})

export const FileHandleSchema = z.discriminatedUnion('kind', [FileEntryHandleSchema, FilePathHandleSchema])
// TODO: 1. Wire schema and types, so no as cast needed
// TODO: 2. Add brand for FileHandle since factory function has been used

// ═══════════════════════════════════════════════════════════════════════════
// FileRef — association from a business entity (chat message, painting, …) to a
// FileEntry. Combines every registered business-domain variant into a single
// discriminated union keyed on `sourceType`.
// ═══════════════════════════════════════════════════════════════════════════
//
// ## Adding a new persistent business ref
//
// 1. Add a variant section below (`{domain}SourceType` / `{domain}Roles` /
//    `{domain}RefFields` / `{domain}FileRefSchema = createRefSchema(...)`),
//    following `tempSession` as a minimal template.
// 2. Add a dedicated SQLite association table with FKs to `file_entry` and the
//    owning source table so deleting the source cascades refs at the DB layer.
// 3. Register the variant in the aggregate: add its source-type literal to
//    `allSourceTypes` and its schema to the `FileRefSchema` union.
// 4. Route persistent write/delete through the owning business service;
//    `FileRefService` only exposes cross-source query/ref-count + temp helpers.
//
// `temp_session` is the exception: app-session memory only (CacheService), not
// SQLite, pruned via orphan sweep. Knowledge files are owned by the Knowledge
// workflow and do not register FileManager refs.

// ─── Common ref infrastructure ───

export const refCommonFields = Object.freeze({
  /** Reference ID (UUID v4) */
  id: z.uuidv4(),
  /** Referenced file entry ID (UUID v7) */
  fileEntryId: FileEntryIdSchema,
  /** Creation timestamp (ms epoch) */
  createdAt: TimestampSchema,
  /** Last update timestamp (ms epoch) */
  updatedAt: TimestampSchema
})

/**
 * Shape constraint for business-specific ref fields passed to `createRefSchema`.
 *
 * `sourceId` uses `z.ZodType<string>` rather than `z.ZodUUID | z.ZodString`
 * so each variant can pick the strictest subtype (e.g. `z.uuidv7()` for
 * first-class domain objects, `z.string().min(1)` for opaque session IDs) —
 * the base shape stays honest about the variance instead of type-eroding
 * down to `z.ZodString`.
 */
export type BusinessRefShape = {
  /** Which business domain owns this reference (e.g. 'chat', 'knowledge', 'painting') */
  sourceType: z.ZodLiteral<string>
  /** The owning business entity's ID (e.g. a message ID, a knowledge item ID) */
  sourceId: z.ZodType<string>
  /** How the file is used within that domain (e.g. 'attachment', 'source', 'asset') */
  role: z.ZodEnum
}

/**
 * Factory: creates a typed FileRef schema by merging common fields
 * (`id`, `fileEntryId`, `createdAt`, `updatedAt`) with business-specific fields
 * (`sourceType`, `sourceId`, `role`).
 *
 * Each sourceType variant should call this once. See the `tempSession` section
 * below for a minimal working example.
 */
export const createRefSchema = <T extends BusinessRefShape>(shape: T): z.ZodObject<typeof refCommonFields & T> =>
  z.object({
    ...refCommonFields,
    ...shape
  })

// ─── temp_session variant ───
//
// Tracks transient FileEntry records (typically paste previews, draft
// attachments) that are in use by a session and should be retained until the
// session completes. Temp refs are backed by main-process CacheService memory,
// not SQLite, so they disappear on app restart. Temp refs must be explicitly
// created and removed by the session owner.

export const tempSessionSourceType = 'temp_session' as const

export const tempSessionRoles = ['pending'] as const

/** Business fields only (no common fields like id/nodeId/timestamps) */
export const tempSessionRefFields = {
  sourceType: z.literal(tempSessionSourceType),
  sourceId: z.string().min(1),
  role: z.enum(tempSessionRoles)
}

export const tempSessionFileRefSchema = createRefSchema(tempSessionRefFields)

// ─── chat_message variant ───
//
// Links a FileEntry to a message row in the v2 chat subsystem. The owning
// service writes refs when a message is created with file or image blocks. The
// association table has an FK to `message`, so message deletion cascades its
// refs at the database layer.
//
// `sourceId` uses `MessageIdSchema = z.uuid()` (not `z.uuidv7()`) because v1
// legacy message IDs are UUIDv4 and are preserved verbatim during migration;
// both formats are valid UUIDs, so `z.uuid()` accepts both. `role` is
// `'attachment'` for both image blocks and file blocks — the single meaningful
// relationship a file can have with a message at this stage.

export const chatMessageSourceType = 'chat_message' as const

export const chatMessageRoles = ['attachment'] as const
export const chatMessageRoleSchema = z.enum(chatMessageRoles)

export const chatMessageRefFields = {
  sourceType: z.literal(chatMessageSourceType),
  sourceId: MessageIdSchema,
  role: chatMessageRoleSchema
}

export const chatMessageFileRefSchema = createRefSchema(chatMessageRefFields)

// ─── painting variant ───
//
// Links a FileEntry to a `painting` row in the v2 paintings subsystem. The
// painting association table holds two buckets — generated `output` files and
// `input` files — which map directly to the two roles below. Painting row
// deletion is handled by DB-level cascade; explicit cleanup is still used when
// replacing a painting's file set wholesale.
//
// `painting.id` is `uuidPrimaryKey()` — UUID v4 (not v7; paintings have no
// ordered-id requirement, unlike `knowledge_item`). Extending `paintingRoles`
// later is additive: rows whose role falls outside the set surface as
// `ZodError`, the desired clean-up signal.

export const paintingSourceType = 'painting' as const

export const paintingRoles = ['output', 'input'] as const
export const paintingRoleSchema = z.enum(paintingRoles)

export const paintingRefFields = {
  sourceType: z.literal(paintingSourceType),
  sourceId: z.uuidv4(),
  role: paintingRoleSchema
}

export const paintingFileRefSchema = createRefSchema(paintingRefFields)

// ─── SourceType type (load-bearing — keys DataApi/query validation) ───

/**
 * All currently-registered FileRef source types — the complete type union.
 *
 * The tuple form is required so `FileRefSourceType` infers as a union of
 * string literals rather than `string`. DataApi handlers and query facades use
 * the same tuple for runtime validation and discriminated-union narrowing.
 *
 * Other business domains (note) deliberately do NOT appear here. They will be
 * added when their owning DB tables migrate to v2 — at which point each variant
 * gains its tuple entry, its `createRefSchema` variant, and its FK-constrained
 * association table in one PR. Keeping those surfaces in lockstep prevents the
 * "type declared but schema unaware" gap.
 */
export const allSourceTypes = [
  tempSessionSourceType,
  chatMessageSourceType,
  paintingSourceType
] as const satisfies readonly string[]
export type FileRefSourceType = (typeof allSourceTypes)[number]

/**
 * Runtime validator for `FileRefSourceType` — used by DataApi handlers to
 * guard `sourceType` query parameters before reaching the service. Stays in
 * lockstep with `allSourceTypes` because it derives from the same tuple.
 */
export const FileRefSourceTypeSchema = z.enum(allSourceTypes)

// ─── Discriminated Union ───

/**
 * Runtime-validated FileRef schema covering every variant in `allSourceTypes`.
 * `FileRefSchema.parse` accepts any registered variant and rejects rows whose
 * `sourceType` is not in this union — the desired behavior, because a row with
 * an unregistered sourceType implies either a stale artefact or a bug that
 * bypassed the variant-registration discipline.
 */
export const FileRefSchema = z.discriminatedUnion('sourceType', [
  tempSessionFileRefSchema,
  chatMessageFileRefSchema,
  paintingFileRefSchema
])
export type FileRef = z.infer<typeof FileRefSchema>
