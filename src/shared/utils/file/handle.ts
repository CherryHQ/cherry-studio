import type { FileEntryHandle, FileEntryId, FileHandle, FilePathHandle } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'

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
 * Like {@link createFileEntryHandle}, this does not re-validate. The
 * `AbsoluteFilePath` brand already proves the value passed
 * `AbsoluteFilePathSchema.parse` — non-empty, no null bytes, not a `file://`
 * URL, and absolute in either POSIX (`/...`) or Windows (`C:\...` / `C:/...`)
 * form. Runtime validation lives at that production boundary; re-checking here
 * would duplicate the schema and risk drifting from it (an earlier hand-rolled
 * check rejected the `C:/` form the schema accepts — see PR review #16740).
 */
export function createFilePathHandle(path: AbsoluteFilePath): FilePathHandle {
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
