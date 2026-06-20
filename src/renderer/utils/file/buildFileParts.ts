/**
 * Renderer-side helper: turn the user's attached files into v2 `FileUIPart`s
 * that survive userData moves.
 *
 * Both the chat send flow (`V2ChatContent.handleSendV2`) and the edit flow
 * (`MessageEditor.buildFinalParts`) feed legacy `FileMetadata` (the shape
 * the existing attach handlers — drop / paste / picker — produce) into
 * here and get back AI-SDK-shaped `FileUIPart`s. Internally each file is
 * promoted to a v2 `FileEntry` via `createInternalEntry`; the resulting
 * `fileEntryId` lives in `providerMetadata.cherry` so
 * `fileProcessor.resolveFileUIPart` (main) can read it path-independently —
 * see `packages/shared/data/types/uiParts.ts` for the accessor + Zod.
 *
 * Phase 2 follow-up: producer-side (drop / paste / picker handlers) should
 * eventually create the FileEntry at attach time and hand `FileEntry[]`
 * down the chat-attach chain; this helper would then drop the
 * `createInternalEntry` call and shrink to just `getPhysicalPath +
 * withCherryMeta`.
 */

import type { FileMetadata } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types/file'
import type { FileUIPart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import type { FilePath } from '@shared/types/file/common'

function mediaTypeFor(file: FileMetadata, ext: string): string {
  if (file.type === FILE_TYPE.IMAGE) {
    const bare = ext.replace(/^\./, '')
    if (!bare) return 'image/png'
    return `image/${bare === 'jpg' ? 'jpeg' : bare === 'svg' ? 'svg+xml' : bare}`
  }
  return 'application/octet-stream'
}

/**
 * For each `FileMetadata` (with an absolute `path`), create a v2 internal
 * FileEntry (Cherry copies the bytes into its own storage) and return a
 * `FileUIPart` that carries the new `fileEntryId` plus a `file://` URL
 * pointing at the freshly-copied physical file.
 */
export async function buildFilePartsForAttachments(files: FileMetadata[]): Promise<FileUIPart[]> {
  return Promise.all(
    files.map(async (file) => {
      const entry = await window.api.file.createInternalEntry({ source: 'path', path: file.path as FilePath })
      const physicalPath = await window.api.file.getPhysicalPath({ id: entry.id })
      const ext = entry.ext ?? file.ext ?? ''
      const basePart: FileUIPart = {
        type: 'file',
        mediaType: mediaTypeFor(file, ext),
        url: `file://${physicalPath}`,
        filename: file.origin_name || file.name
      }
      return withCherryMeta(basePart, { fileEntryId: entry.id })
    })
  )
}
