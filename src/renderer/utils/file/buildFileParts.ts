/**
 * Renderer-side send-time bridge: turn the composer's `ComposerAttachment`s
 * into v2 `FileUIPart`s that survive userData moves.
 *
 * The composer holds lean `ComposerAttachment` descriptors; the v2 `FileEntry`
 * is created here, when the message is actually sent. Each attachment is
 * promoted to an internal `FileEntry` via `createInternalEntry` (Cherry copies
 * the bytes into its own storage); the resulting `fileEntryId` lives in
 * `providerMetadata.cherry` so `fileProcessor.resolveFileUIPart` (main) can read
 * it path-independently — see `packages/shared/data/types/uiParts.ts` for the
 * accessor + Zod.
 */

import type { ComposerAttachment } from '@renderer/utils/messageUtils/composerAttachment'
import type { FileUIPart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import type { FilePath } from '@shared/types/file/common'
import { createFileEntryHandle } from '@shared/utils/file/handle'

/**
 * For each `ComposerAttachment` (with an absolute `path`), create a v2 internal
 * FileEntry (Cherry copies the bytes into its own storage) and return a
 * `FileUIPart` that carries the new `fileEntryId` plus a `file://` URL
 * pointing at the freshly-copied physical file.
 */
export async function buildFilePartsForAttachments(attachments: ComposerAttachment[]): Promise<FileUIPart[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      const entry = await window.api.file.createInternalEntry({ source: 'path', path: attachment.path as FilePath })
      const physicalPath = await window.api.file.getPhysicalPath({ id: entry.id })
      const metadata = await window.api.file.getMetadata(createFileEntryHandle(entry.id))
      const basePart: FileUIPart = {
        type: 'file',
        mediaType: metadata.kind === 'file' ? metadata.mime : 'application/octet-stream',
        url: `file://${physicalPath}`,
        filename: attachment.origin_name || attachment.name
      }
      return withCherryMeta(basePart, { fileEntryId: entry.id })
    })
  )
}
