/**
 * FileInfo — descriptor for an unmanaged file on disk.
 *
 * Paired with `UnmanagedFileHandle` on the reference side. Together they form
 * the "unmanaged half" of the FileHandle ⊕ data-shape symmetry:
 *
 * ```
 *  reference layer                  data-shape layer
 *  ─────────────────                ─────────────────
 *  ManagedFileHandle   ──resolve──▶ FileEntry      (DB-row snapshot, identity-first)
 *  UnmanagedFileHandle ──resolve──▶ FileInfo       (live disk descriptor, path-first)
 * ```
 *
 * ## Relationship to FileEntry
 *
 * FileInfo and FileEntry share many fields (`name`, `ext`, `size`, etc.)
 * because every file has these attributes regardless of whether it is managed.
 * The difference is **semantic**, not structural:
 *
 * | Aspect          | FileInfo                                  | FileEntry                                    |
 * |-----------------|-------------------------------------------|----------------------------------------------|
 * | Liveness        | Live view — each read may differ          | DB snapshot — decoupled from physical state  |
 * | Addressing      | `path` (always present)                   | `id` (always present); path is derived       |
 * | Produced by     | `ops.stat(path)` / `toFileInfo(entry)`    | `createInternalEntry` / `ensureExternalEntry`|
 * | Lifecycle       | None — transient per-call descriptor       | Persistent DB row; trash/restore for internal|
 *
 * ## When to use FileInfo vs FileEntry in signatures
 *
 * Primary axis: **is the file managed by Cherry?** This is a property of the
 * file, not of the consumer. See
 * [architecture.md](../../../../docs/references/file/architecture.md) for the
 * full decision matrix. Quick rules:
 *
 * - Accept `FileHandle` when the operation is meaningful on both managed and
 *   unmanaged files (read / open / getMetadata / most IPC). The handler
 *   dispatches on `handle.kind`.
 * - Accept `FileEntry` (or `FileEntryId`) only when the operation requires
 *   managed-file identity: persisting a reference, calling FileManager
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
 * @see {@link FileEntry} for the managed-file counterpart.
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
