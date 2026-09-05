/**
 * Persist-time relocation of natively generated images.
 *
 * A chat-style image model (Gemini `responseModalities`) returns its image inline as a `data:`
 * URL. Persisting that verbatim puts megabytes of base64 in `message.data` and ships them to the
 * renderer on every topic load, so each one moves to a FileEntry and the part keeps a `file://`
 * URL plus the `fileEntryId` — the same shape the composer's upload path produces.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import type { Base64String } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'

const logger = loggerService.withContext('relocateInlineImages')

function isInlineImagePart(part: CherryMessagePart): boolean {
  return part.type === 'file' && part.mediaType.startsWith('image/') && part.url.startsWith('data:')
}

export async function relocateInlineImages(parts: CherryMessagePart[]): Promise<CherryMessagePart[]> {
  if (!parts.some(isInlineImagePart)) return parts

  const fileManager = application.get('FileManager')
  return Promise.all(
    parts.map(async (part) => {
      if (part.type !== 'file' || !isInlineImagePart(part)) return part
      try {
        const entry = await fileManager.createInternalEntry({
          source: 'base64',
          data: part.url as Base64String,
          cleanupPolicy: 'delete_when_unreferenced'
        })
        return withCherryMeta(
          { ...part, url: toFileUrl(fileManager.getPhysicalPath(entry.id)) },
          { fileEntryId: entry.id }
        )
      } catch (error) {
        // Keeping the data URL costs storage; dropping the part loses the image the user paid for.
        logger.error('Failed to relocate a generated image, persisting it inline', error as Error)
        return part
      }
    })
  )
}
