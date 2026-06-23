import type { FileEntryId } from '@shared/data/types/file'
import type { FileEntryHandle, FileHandle, FilePath, FilePathHandle } from '@shared/types/file'

/**
 * Wrap a FileEntry ID as a `FileEntryHandle`.
 *
 * The caller is responsible for ensuring `entryId` is a valid UUID —
 * typically produced by a FileManager factory or the DataApi response. This
 * factory does not re-validate: `FileEntryId` is a type alias over `string`
 * (see `FileEntryIdSchema`), and runtime validation happens at the entry
 * *production* boundaries, not when wrapping an existing id.
 */
export function createFileEntryHandle(entryId: FileEntryId): FileEntryHandle {
  return { kind: 'entry', entryId }
}

/**
 * Wrap an absolute filesystem path as a `FilePathHandle`.
 *
 * ## Runtime validation
 *
 * The `FilePath` template-literal type (`` `/${string}` | `${string}:\\${string}` ``)
 * is a compile-time hint, but untyped entry points (IPC payloads, `as FilePath`
 * casts, renderer-side dynamic construction) can bypass it. This factory runs
 * a cheap runtime check so a bad path fails at wrap time rather than surfacing
 * as a confusing failure inside `@main/utils/file/fs.read` / FileManager several layers down.
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
export function createFilePathHandle(path: FilePath): FilePathHandle {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('createFilePathHandle: path must be a non-empty string')
  }
  if (path.startsWith('file://')) {
    throw new TypeError('createFilePathHandle: path must be a filesystem path, not a file:// URL')
  }
  const isPosixAbsolute = path.startsWith('/')
  const isWindowsAbsolute = /^[A-Za-z]:\\/.test(path)
  if (!isPosixAbsolute && !isWindowsAbsolute) {
    throw new TypeError(`createFilePathHandle: path must be absolute (got ${JSON.stringify(path)})`)
  }
  return { kind: 'path', path }
}

/** Type guard: narrow to the entry-handle variant. */
export function isFileEntryHandle(handle: FileHandle): handle is FileEntryHandle {
  return handle.kind === 'entry'
}

/** Type guard: narrow to the path-handle variant. */
export function isFilePathHandle(handle: FileHandle): handle is FilePathHandle {
  return handle.kind === 'path'
}
