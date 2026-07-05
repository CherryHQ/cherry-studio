/**
 * Renderer-side send-time bridge: turn the composer's `ComposerAttachment`s
 * into v2 `FileUIPart`s that survive userData moves.
 *
 * The composer holds lean `ComposerAttachment` descriptors; the v2 `FileEntry`
 * is created here, when the message is actually sent. Each attachment is
 * promoted to an internal `FileEntry` via `createInternalEntry` (Cherry copies
 * the bytes into its own storage); the resulting `fileEntryId` lives in
 * `providerMetadata.cherry` so `fileProcessor.materializeNativeFilePart` (main)
 * can read it path-independently — see `packages/shared/data/types/uiParts.ts`
 * for the accessor + Zod.
 */

import { loggerService } from '@logger'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileUIPart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import { FilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file/handle'

const logger = loggerService.withContext('buildFileParts')

/**
 * For each `ComposerAttachment` (with an absolute `path`), create a v2 internal
 * FileEntry (Cherry copies the bytes into its own storage) and return a
 * `FileUIPart` that carries the new `fileEntryId` plus a `file://` URL
 * pointing at the freshly-copied physical file.
 *
 * A single attachment failing (e.g. a legacy/non-absolute `path`) is isolated:
 * it is logged and skipped rather than rejecting the whole batch.
 */
export async function buildFilePartsForAttachments(attachments: ComposerAttachment[]): Promise<FileUIPart[]> {
  const results = await Promise.allSettled(
    attachments.map(async (attachment) => {
      const entry = await window.api.file.createInternalEntry({
        source: 'path',
        path: FilePathSchema.parse(attachment.path)
      })
      const physicalPath = await window.api.file.getPhysicalPath({ id: entry.id })
      const metadata = await window.api.file.getMetadata(createFilePathHandle(physicalPath))
      const basePart: FileUIPart = {
        type: 'file',
        mediaType: metadata.kind === 'file' ? metadata.mime : 'application/octet-stream',
        url: `file://${physicalPath}`,
        filename: attachment.origin_name || attachment.name
      }
      return withCherryMeta(basePart, { fileEntryId: entry.id })
    })
  )

  const parts: FileUIPart[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      parts.push(result.value)
      return
    }
    const attachment = attachments[index]
    logger.warn('failed to build file part for attachment, skipping it', {
      path: attachment.path,
      name: attachment.name,
      error: result.reason
    })
  })
  return parts
}
