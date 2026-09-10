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

import { ipcApi } from '@renderer/ipc'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileUIPart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import { createFilePathHandle, toFileUrl } from '@shared/utils/file'

export function withComposerFilePartMeta(
  part: FileUIPart,
  attachment: Pick<ComposerAttachment, 'fileTokenSourceId' | 'composerFileKind' | 'path'>,
  fileEntryId?: string
): FileUIPart {
  return withCherryMeta(part, {
    ...(fileEntryId ? { fileEntryId } : {}),
    fileTokenSourceId: attachment.fileTokenSourceId,
    ...(attachment.composerFileKind ? { composerFileKind: attachment.composerFileKind } : {}),
    ...(attachment.path ? { originalPath: attachment.path } : {})
  })
}

/**
 * For each `ComposerAttachment`, create a v2 internal FileEntry (Cherry copies
 * the bytes into its own storage) and return a `FileUIPart` that carries the new
 * `fileEntryId` plus a `file://` URL pointing at the freshly-copied physical file.
 *
 * `ComposerAttachment.path` is already an `AbsoluteFilePath` — producers validate
 * it — so the only precondition left here is that the path is *present*: an
 * attachment reconstructed for message editing carries none, and such an
 * attachment must never be re-sent through `createInternalEntry` (the edit flow
 * reuses the original part instead).
 *
 * That check runs over the WHOLE batch before the first IPC. `createInternalEntry`
 * copies bytes and inserts a row, and neither orphan sweep reclaims the result
 * (the DB sweep only reports zero-ref entries; the FS sweep only unlinks files
 * with no DB row), so a mid-flight rejection would leave permanent residue that
 * every retry duplicates.
 *
 * A rejected `createInternalEntry` still leaves that residue — this batch is not
 * atomic — but that failure mode is independent of the caller's input.
 */
export async function buildFilePartsForAttachments(attachments: ComposerAttachment[]): Promise<FileUIPart[]> {
  const paths = attachments.map((attachment) => {
    if (!attachment.path) {
      throw new Error(`Cannot send attachment "${attachment.origin_name || attachment.name}": it has no file path`)
    }
    return attachment.path
  })
  return Promise.all(
    attachments.map(async (attachment, index) => {
      const entry = await window.api.file.createInternalEntry({
        source: 'path',
        path: paths[index],
        cleanupPolicy: 'delete_when_unreferenced'
      })
      const physicalPath = await window.api.file.getPhysicalPath({ id: entry.id })
      const metadata = await ipcApi.request('file.get_metadata', createFilePathHandle(physicalPath))
      if (metadata === null) {
        // The physical file was just created by createInternalEntry above, so an
        // unreadable (null) metadata means a broken internal invariant — surface
        // it here rather than silently shipping an octet-stream part.
        throw new Error(`Failed to read metadata for freshly created file entry ${entry.id}`)
      }
      const basePart: FileUIPart = {
        type: 'file',
        mediaType: metadata.kind === 'file' ? metadata.mime : 'application/octet-stream',
        url: toFileUrl(physicalPath),
        filename: attachment.origin_name || attachment.name
      }
      return withComposerFilePartMeta(basePart, attachment, entry.id)
    })
  )
}
