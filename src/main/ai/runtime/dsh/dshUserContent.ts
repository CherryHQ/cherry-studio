import type { BridgeContentBlock, BridgeImageBlock } from '@cherrystudio/dsh-bridge'
import { loggerService } from '@logger'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { FileUIPart } from '@shared/data/types/message'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { imageExts } from '@shared/utils/file'

const logger = loggerService.withContext('dshUserContent')

export interface DshUserContentOptions {
  /** Send image blocks only when the selected dsh model declares image input. */
  includeImages?: boolean
}

/** Build DSH content blocks while leaving non-image attachments as filesystem paths. */
export async function buildDshUserContentBlocks(
  message: AgentSessionMessageEntity,
  options: DshUserContentOptions = {}
): Promise<BridgeContentBlock[]> {
  const images = new Map<FileUIPart, BridgeImageBlock>()
  if (options.includeImages !== false) {
    for (const part of message.data?.parts ?? []) {
      if (part.type !== 'file' || !isImageFilePart(part)) continue
      const image = await readImagePart(part)
      if (image) images.set(part, image)
    }
  }

  const text = buildAgentUserContent(message, { includeAttachment: (part) => !images.has(part) })
  const blocks: BridgeContentBlock[] = [{ type: 'text', text }]
  for (const part of message.data?.parts ?? []) {
    if (part.type !== 'file') continue
    const image = images.get(part)
    if (image) blocks.push(image)
  }
  return blocks
}

function isImageFilePart(part: FileUIPart): boolean {
  if (part.mediaType?.toLowerCase().startsWith('image/')) return true
  const filename = part.filename?.toLowerCase()
  const url = part.url && !part.url.startsWith('data:') ? part.url.toLowerCase().split(/[?#]/, 1)[0] : undefined
  return imageExts.some((extension) => filename?.endsWith(extension) || url?.endsWith(extension))
}

async function readImagePart(part: FileUIPart): Promise<BridgeImageBlock | undefined> {
  try {
    const materialized = await materializeNativeFilePart(part)
    const parsed = materialized?.url ? parseDataUrl(materialized.url) : null
    const mediaType = normalizeImageMediaType(parsed?.mediaType)
    if (!parsed?.isBase64 || !parsed.data || !mediaType) return undefined

    return {
      type: 'image',
      mediaType,
      data: parsed.data,
      ...(part.filename ? { name: part.filename } : {})
    }
  } catch (error) {
    logger.warn('Falling back to the image path because the attachment could not be read', {
      name: part.filename,
      error
    })
    return undefined
  }
}

function normalizeImageMediaType(value: string | undefined): BridgeImageBlock['mediaType'] | undefined {
  switch (value?.toLowerCase()) {
    case 'image/jpg':
    case 'image/jpeg':
      return 'image/jpeg'
    case 'image/png':
      return 'image/png'
    case 'image/webp':
      return 'image/webp'
    case 'image/gif':
      return 'image/gif'
    default:
      return undefined
  }
}
