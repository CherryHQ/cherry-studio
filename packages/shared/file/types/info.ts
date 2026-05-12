/**
 * FileInfo — live descriptor of a file on disk, identified by `path`.
 *
 * Paired with `FilePathHandle` on the reference side. Together they form the
 * path-indexed half of the FileHandle ⊕ data-shape symmetry:
 *
 * ```
 *  reference layer                  data-shape layer
 *  ─────────────────                ─────────────────
 *  FileEntryHandle   ──resolve──▶ FileEntry      (DB-row snapshot, identity-first)
 *  FilePathHandle    ──resolve──▶ FileInfo       (live disk descriptor, path-first)
 * ```
 *
 * ## Relationship to FileEntry
 *
 * FileInfo and FileEntry share many fields (`name`, `ext`, `size`, etc.)
 * because every file has these attributes regardless of whether a FileEntry
 * row exists for it. The difference is **semantic**, not structural:
 *
 * | Aspect          | FileInfo                                  | FileEntry                                              |
 * |-----------------|-------------------------------------------|--------------------------------------------------------|
 * | Liveness        | Live view — each read may differ          | Persistent record — identity + stable projections only |
 * | Addressing      | `path` (always present)                   | `id` (always present); path is derived                 |
 * | Produced by     | `@main/utils/file/fs.stat(path)` / `toFileInfo(entry)` | `createInternalEntry` / `ensureExternalEntry`     |
 * | Lifecycle       | None — transient per-call descriptor       | Persistent DB row; trash/restore for internal          |
 *
 * ## When to use FileInfo vs FileEntry in signatures
 *
 * Primary axis: **which subsystem does the caller want in the loop?** The
 * entry system (FileManager, versionCache, DanglingCache) or just raw FS
 * (`@main/utils/file/*`). This is a call-site choice, not an intrinsic file property — the
 * same physical file can be reached either way. See
 * [architecture.md](../../../../docs/references/file/architecture.md) for the
 * full decision matrix. Quick rules:
 *
 * - Accept `FileHandle` when the operation is meaningful regardless of which
 *   subsystem the caller picked (read / open / getMetadata / most IPC). The
 *   handler dispatches on `handle.kind`.
 * - Accept `FileEntry` (or `FileEntryId`) only when the operation requires
 *   entry-system identity: persisting a reference, calling FileManager
 *   lifecycle methods, rendering the Files management UI.
 * - Accept `FileInfo` only at the leaf — pure content/attribute processors
 *   (OCR, tokenization, hashing) that work off a resolved on-disk descriptor.
 *   In practice FileInfo more often appears as a *return type* (@main/utils/file/fs.stat,
 *   export producers) than as a parameter type.
 *
 * Projection is one-way: `FileEntry → FileInfo` via `toFileInfo(entry)`
 * (async — reads live `fs.stat` for size/mtime). Reverse requires explicit
 * registration through FileManager; there is no implicit upgrade.
 *
 * ## Rich per-kind metadata
 *
 * FileInfo deliberately stays flat and cheap to construct. For per-kind
 * details (image width/height, PDF pageCount, text encoding), call
 * `ops.getMetadata(path)` and inspect the resulting `PhysicalFileMetadata`
 * discriminated union — do not extend FileInfo.
 */

import * as z from 'zod'

import type { FilePath } from './common'
import { FileTypeSchema } from './common'

/**
 * Zod schema for `FileInfo`. Branded so consumers cannot construct a raw
 * object literal that satisfies the structure but skipped validation —
 * matches the discipline `FileEntry` / `FileRef` / `DanglingState` already
 * follow. Parse it at every IPC boundary that returns `FileInfo`
 * (`getMetadata` and friends).
 *
 * The schema mirrors the `FileInfo` interface 1:1; the inferred type is the
 * source of truth and `FileInfo` re-exports it below.
 */
export const FileInfoSchema = z
  .strictObject({
    /**
     * Absolute filesystem path. The TypeScript template-literal `FilePath`
     * brand is enforced only at the type level; the runtime check here is
     * the same shape gate (`/`-prefixed POSIX or `X:\` Windows drive)
     * plus a null-byte rejection — anything that survives is safe to feed
     * to `fs` APIs.
     */
    path: z
      .string()
      .min(1)
      .refine((s) => !s.includes('\0'), 'path must not contain null bytes')
      .refine((s) => s.startsWith('/') || /^[A-Za-z]:\\/.test(s), 'path must be an absolute filesystem path'),
    /** Basename without extension. */
    name: z.string(),
    /** Extension without leading dot, or `null` for extensionless files. */
    ext: z.string().nullable(),
    /** Size in bytes (live from `fs.stat`). */
    size: z.int().nonnegative(),
    /** MIME type (derived from `ext`). */
    mime: z.string(),
    /** Coarse content classification (derived from `ext`). */
    type: FileTypeSchema,
    /** Creation timestamp (ms epoch). */
    createdAt: z.int().nonnegative(),
    /** Last-modified timestamp (ms epoch, from `fs.stat` mtime). */
    modifiedAt: z.int().nonnegative()
  })
  .brand<'FileInfo'>()

/**
 * Descriptor for a file on disk. Flat, cheap to construct, no identity.
 *
 * @see {@link FileEntry} for the entry-system counterpart.
 * @see {@link PhysicalFileMetadata} for per-kind rich stat (dimensions,
 *      pageCount, etc.).
 *
 * Inferred from `FileInfoSchema`; the schema is the source of truth.
 * The runtime `path` shape check is intentionally weaker than the TS
 * `FilePath` template literal (template literals can't be expressed in
 * Zod) — the field is still typed as `FilePath` here for ergonomics
 * everywhere it crosses an IPC boundary.
 */
export type FileInfo = Omit<z.infer<typeof FileInfoSchema>, 'path'> & { readonly path: FilePath }
