/**
 * FileHandle — unified reference to any file accessible by Cherry.
 *
 * A handle is a **call-site choice of reference form**, not a statement about
 * the file's ownership or registration status:
 * - `FileEntryHandle` carries a `FileEntryId` — the call goes through the
 *   entry system (FileManager, versionCache, DanglingCache, …).
 * - `FilePathHandle` carries an absolute `FilePath` — the call bypasses the
 *   entry system and hits `@main/utils/file/*` directly.
 *
 * The same physical file can be referenced by either form. In particular, an
 * external file that has a FileEntry can also be reached via a `FilePathHandle`
 * (with different side-effect semantics: no DanglingCache update, no version
 * cache lookup, no identity-tracked ops). Picking a form is the caller's
 * decision, driven by which subsystem they want in the loop.
 *
 * Distinct from `FileRef` (the file_ref table, which links business entities
 * like chat_message to FileEntry).
 *
 * ## Examples
 *
 * ```ts
 * const h1 = createFileEntryHandle(entry.id)               // routes via FileManager
 * const h2 = createFilePathHandle('/Users/me/doc.pdf')     // routes via @main/utils/file/*
 *
 * // IPC / service methods accept either
 * await window.api.file.read(h1)     // FileManager.read — entry-aware
 * await window.api.file.read(h2)     // raw FS read       — entry-agnostic
 * ```
 */

import type { FileEntryId } from '@shared/data/types/file'

import type { FilePath } from './common'

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
 * Wrap a FileEntry ID as a `FileEntryHandle`.
 *
 * The caller is responsible for ensuring `entryId` is a valid UUID v7 —
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
