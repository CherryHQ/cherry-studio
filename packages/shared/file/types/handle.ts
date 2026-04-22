/**
 * FileHandle — unified reference to any file accessible by Cherry.
 *
 * Consumers can hold a `FileHandle` without knowing whether the underlying
 * file is managed by Cherry (has a FileEntry) or just an arbitrary path.
 *
 * Distinct from `FileRef` (the file_ref table, which links business entities
 * like chat_message to FileEntry).
 *
 * ## Examples
 *
 * ```ts
 * const h1 = createManagedHandle(entry.id)               // points at FileEntry
 * const h2 = createUnmanagedHandle('/Users/me/doc.pdf')  // points at filesystem path
 *
 * // IPC / service methods accept either
 * await window.api.file.read(h1)     // resolves via FileManager + entry.externalPath
 * await window.api.file.read(h2)     // resolves via ops.read(path)
 * ```
 */

import type { FileEntryId } from '@shared/data/types/file'

import type { FilePath } from './common'

export type ManagedFileHandle = {
  readonly kind: 'managed'
  readonly entryId: FileEntryId
}

export type UnmanagedFileHandle = {
  readonly kind: 'unmanaged'
  readonly path: FilePath
}

export type FileHandle = ManagedFileHandle | UnmanagedFileHandle

/**
 * Wrap a FileEntry ID as a managed FileHandle.
 *
 * The caller is responsible for ensuring `entryId` is a valid UUID v7 —
 * typically produced by a FileManager factory or the DataApi response. This
 * factory does not re-validate: `FileEntryId` is a type alias over `string`
 * (see `FileEntryIdSchema`), and runtime validation happens at the entry
 * *production* boundaries, not when wrapping an existing id.
 */
export function createManagedHandle(entryId: FileEntryId): ManagedFileHandle {
  return { kind: 'managed', entryId }
}

/**
 * Wrap an absolute filesystem path as an unmanaged FileHandle.
 *
 * ## Runtime validation
 *
 * The `FilePath` template-literal type (`` `/${string}` | `${string}:\\${string}` ``)
 * is a compile-time hint, but untyped entry points (IPC payloads, `as FilePath`
 * casts, renderer-side dynamic construction) can bypass it. This factory runs
 * a cheap runtime check so a bad path fails at wrap time rather than surfacing
 * as a confusing failure inside `ops.read` / FileManager several layers down.
 *
 * Rejected inputs:
 * - Relative paths (`./foo`, `foo/bar`)
 * - `file://` URLs — use `FileURLString` and a dedicated conversion path
 * - Empty string
 *
 * Accepted: POSIX absolute (`/...`) and Windows absolute (`C:\...`).
 *
 * @throws {TypeError} When `path` is not a non-empty absolute filesystem path.
 */
export function createUnmanagedHandle(path: FilePath): UnmanagedFileHandle {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('createUnmanagedHandle: path must be a non-empty string')
  }
  if (path.startsWith('file://')) {
    throw new TypeError('createUnmanagedHandle: path must be a filesystem path, not a file:// URL')
  }
  const isPosixAbsolute = path.startsWith('/')
  const isWindowsAbsolute = /^[A-Za-z]:\\/.test(path)
  if (!isPosixAbsolute && !isWindowsAbsolute) {
    throw new TypeError(`createUnmanagedHandle: path must be absolute (got ${JSON.stringify(path)})`)
  }
  return { kind: 'unmanaged', path }
}

/** Type guard: narrow to the managed variant. */
export function isManagedHandle(handle: FileHandle): handle is ManagedFileHandle {
  return handle.kind === 'managed'
}

/** Type guard: narrow to the unmanaged variant. */
export function isUnmanagedHandle(handle: FileHandle): handle is UnmanagedFileHandle {
  return handle.kind === 'unmanaged'
}
