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
 * | Produced by     | `ops.stat(path)` / `toFileInfo(entry)`    | `createInternalEntry` / `ensureExternalEntry`          |
 * | Lifecycle       | None — transient per-call descriptor       | Persistent DB row; trash/restore for internal          |
 *
 * ## When to use FileInfo vs FileEntry in signatures
 *
 * Primary axis: **which subsystem does the caller want in the loop?** The
 * entry system (FileManager, versionCache, DanglingCache) or just raw FS
 * (`ops/*`). This is a call-site choice, not an intrinsic file property — the
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
 *   In practice FileInfo more often appears as a *return type* (ops.stat,
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

import type { FilePath, FileType } from './common'

/**
 * Descriptor for a file on disk. Flat, cheap to construct, no identity.
 *
 * @see {@link FileEntry} for the entry-system counterpart.
 * @see {@link PhysicalFileMetadata} for per-kind rich stat (dimensions,
 *      pageCount, etc.).
 */
export interface FileInfo {
  /**
   * Absolute filesystem path. Must pass `FilePath` runtime validation.
   * This is the identity of a FileInfo — two `FileInfo`s with the same
   * `path` describe the same file.
   */
  readonly path: FilePath

  /**
   * Basename without extension (e.g. `"report"` for `"/x/report.pdf"`).
   * Matches `FileEntry.name` semantics so projection preserves the field.
   */
  readonly name: string

  /**
   * Extension without leading dot (e.g. `"pdf"`). `null` for extensionless
   * files (e.g. `Dockerfile`). Matches `FileEntry.ext` semantics.
   */
  readonly ext: string | null

  /** Size in bytes (live from `fs.stat`). */
  readonly size: number

  /** MIME type (derived from `ext`; `"application/octet-stream"` when unknown). */
  readonly mime: string

  /** Coarse content classification (derived from `ext`). */
  readonly type: FileType

  /**
   * Creation timestamp (ms epoch). On filesystems without a reliable birth
   * time, producers fall back to `modifiedAt`.
   */
  readonly createdAt: number

  /** Last-modified timestamp (ms epoch, from `fs.stat` mtime). */
  readonly modifiedAt: number
}
