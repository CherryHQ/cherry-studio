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

/** Wrap a FileEntry ID as a managed FileHandle. */
export function createManagedHandle(entryId: FileEntryId): ManagedFileHandle {
  return { kind: 'managed', entryId }
}

/** Wrap an arbitrary filesystem path as an unmanaged FileHandle. */
export function createUnmanagedHandle(path: FilePath): UnmanagedFileHandle {
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
