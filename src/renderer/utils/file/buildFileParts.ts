/**
 * Renderer-side send-time bridge: turn the composer's `ComposerAttachment`s
 * into v2 `FileUIPart`s that survive userData moves.
 *
 * The composer holds lean `ComposerAttachment` descriptors; the v2 `FileEntry`
 * is created here, when the message is actually sent. Each attachment is
 * promoted to an internal `FileEntry` via `createInternalEntry` (Cherry copies
 * the bytes into its own storage); the resulting `fileEntryId` and the
 * composer's stable `fileTokenSourceId` live in `providerMetadata.cherry` so
 * downstream consumers can identify both the stored file and its composer
 * token association — see `packages/shared/data/types/uiParts.ts` for the
 * accessor + Zod.
 */

import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileUIPart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import type { FilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

export function withComposerFilePartMeta(
  part: FileUIPart,
  attachment: Pick<ComposerAttachment, 'fileTokenSourceId' | 'composerFileKind'>,
  fileEntryId?: string
): FileUIPart {
  return withCherryMeta(part, {
    ...(fileEntryId ? { fileEntryId } : {}),
    fileTokenSourceId: attachment.fileTokenSourceId,
    ...(attachment.composerFileKind ? { composerFileKind: attachment.composerFileKind } : {})
  })
}

/**
 * For each `ComposerAttachment` (with an absolute `path`), create a v2 internal
 * FileEntry (Cherry copies the bytes into its own storage) and return a
 * `FileUIPart` that carries the new `fileEntryId` plus a `file://` URL
 * pointing at the freshly-copied physical file.
 */
export async function buildFilePartsForAttachments(attachments: ComposerAttachment[]): Promise<FileUIPart[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      const entry = await window.api.file.createInternalEntry({
        source: 'path',
        path: attachment.path as FilePath,
        cleanupPolicy: 'delete_when_unreferenced'
      })
      const physicalPath = await window.api.file.getPhysicalPath({ id: entry.id })
      const metadata = await window.api.file.getMetadata(createFilePathHandle(physicalPath))
      const basePart: FileUIPart = {
        type: 'file',
        mediaType: metadata.kind === 'file' ? metadata.mime : 'application/octet-stream',
        url: `file://${physicalPath}`,
        filename: attachment.origin_name || attachment.name
      }
      return withComposerFilePartMeta(basePart, attachment, entry.id)
    })
  )
}
