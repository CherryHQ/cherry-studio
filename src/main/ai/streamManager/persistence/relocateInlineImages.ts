import { application } from '@application'
import { loggerService } from '@logger'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import type { Base64String } from '@shared/types/file'
import { isBase64ImageDataUrl } from '@shared/utils/dataUrl'

const logger = loggerService.withContext('relocateInlineImages')

type InlineImagePart = Extract<CherryMessagePart, { type: 'file' }> & { url: Base64String }

function isInlineImagePart(part: CherryMessagePart): part is InlineImagePart {
  return part.type === 'file' && part.mediaType.startsWith('image/') && isBase64ImageDataUrl(part.url)
}

/** FileManager's own default would label every generated image "Pasted <date>". */
function generatedImageName(part: CherryMessagePart): string {
  const stem = part.type === 'file' ? part.filename?.replace(/\.[^.]+$/, '') : undefined
  // Provider filenames are untrusted and must satisfy the file-entry name rules.
  const safe = stem?.replaceAll('/', '-').replaceAll('\\', '-').replaceAll('\u0000', '-').trim()
  return safe && safe.length > 0 && safe !== '.' && safe !== '..' ? safe.slice(0, 255) : 'Generated image'
}

/** Persist generated images so later turns can read them back as native file parts. */
export async function relocateInlineImages(parts: CherryMessagePart[]): Promise<CherryMessagePart[]> {
  if (!parts.some(isInlineImagePart)) return parts

  const fileManager = application.get('FileManager')
  return Promise.all(
    parts.map(async (part) => {
      if (!isInlineImagePart(part)) return part
      try {
        const entry = await fileManager.createInternalEntry({
          source: 'base64',
          data: part.url,
          cleanupPolicy: 'delete_when_unreferenced',
          name: generatedImageName(part)
        })
        return withCherryMeta({ ...part, url: fileManager.getUrl(entry.id) }, { fileEntryId: entry.id })
      } catch (error) {
        logger.error('Failed to relocate a generated image, persisting it inline', error as Error)
        return part
      }
    })
  )
}
