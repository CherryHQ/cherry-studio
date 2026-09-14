import type { FileHandle } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFileEntryHandle, createFilePathHandle, tryFileUrlToPath } from '@shared/utils/file'

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
