import type { FileEntryHandle, FileEntryId, FileHandle, FilePathHandle } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema, type AbsoluteFilePath } from '@shared/types/file'

import { tryFileUrlToPath } from './url'

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

/**
 * Resolve the {@link FileHandle} a sent file part addresses.
 *
 * The send path records a `fileEntryId` for every attachment it copies into
 * managed storage, so that entry handle is preferred: open, preview, and
 * metadata then all route through FileManager. Parts addressed by path instead
 * (agent workspace references) fall back to the stored `file://` URL.
 *
 * This is the only place a message part's URL is turned back into a path.
 * Every consumer downstream takes the handle and lets Main resolve it — a
 * `file://` URL is percent-encoded, and a hand-rolled scheme strip leaves that
 * encoding in a value the filesystem then fails to open.
 *
 * @returns The handle, or `undefined` when the part carries neither an entry id
 *   nor a URL that decodes to an absolute path.
 */
export function fileHandleFromPart(part: CherryMessagePart): FileHandle | undefined {
  if (part.type !== 'file') return undefined

  const entryId = readCherryMeta(part)?.fileEntryId
  if (entryId) return createFileEntryHandle(entryId)

  const path = part.url ? tryFileUrlToPath(part.url) : undefined
  const parsed = path === undefined ? undefined : AbsoluteFilePathSchema.safeParse(path)
  return parsed?.success ? createFilePathHandle(parsed.data) : undefined
}
