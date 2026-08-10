import type { LanguageModelV3FilePart, LanguageModelV3Prompt } from '@ai-sdk/provider'
import { convertBase64ToUint8Array, isAbortError } from '@ai-sdk/provider-utils'
import { application } from '@application'
import { loggerService } from '@logger'
import { surrogateSafeEnd } from '@main/ai/utils/textPaging'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'

const logger = loggerService.withContext('ImageInputFallback')

const IMAGE_OMITTED_NOTE = '[Image omitted after the provider rejected image input.]'

function isImagePart(part: unknown): part is LanguageModelV3FilePart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'file' &&
    'mediaType' in part &&
    typeof part.mediaType === 'string' &&
    part.mediaType.startsWith('image/')
  )
}

async function resolveImageData(
  part: LanguageModelV3FilePart,
  signal?: AbortSignal
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  if (part.data instanceof Uint8Array) return { data: part.data, mediaType: part.mediaType }
  if (typeof part.data === 'string') {
    return { data: convertBase64ToUint8Array(part.data), mediaType: part.mediaType }
  }

  const downloaded = await downloadImageAsBase64(part.data.toString(), signal)
  if (signal?.aborted) throw signal.reason
  if (!downloaded) return null
  return { data: convertBase64ToUint8Array(downloaded.data), mediaType: downloaded.media_type }
}

function capOcrText(text: string): string {
  if (text.length <= READ_FILE_PAGE_SIZE) return text
  const end = surrogateSafeEnd(text, READ_FILE_PAGE_SIZE)
  return `${text.slice(0, end)}\n\n[OCR text truncated ${end}/${text.length} chars.]`
}

async function imageFallbackText(part: LanguageModelV3FilePart, signal?: AbortSignal): Promise<string> {
  try {
    const image = await resolveImageData(part, signal)
    if (!image) return IMAGE_OMITTED_NOTE
    const text = (
      await application.get('FileProcessingService').ocrImageBytes(image.data, image.mediaType, signal)
    ).trim()
    if (!text) return IMAGE_OMITTED_NOTE
    const name = part.filename?.trim() || 'image'
    return `Attached image "${name}":\n${capOcrText(text)}`
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error
    logger.warn('OCR unavailable while recovering from rejected image input', { error })
    return IMAGE_OMITTED_NOTE
  }
}

/**
 * Replace native image parts with OCR text for the one recovery attempt made
 * after a provider explicitly rejects image input. Returns `null` when the
 * prompt contains no native images.
 */
export async function replaceImageInputsWithOcr(
  prompt: LanguageModelV3Prompt,
  signal?: AbortSignal
): Promise<LanguageModelV3Prompt | null> {
  let changed = false

  const rewritten = await Promise.all(
    prompt.map(async (message) => {
      if (message.role === 'system' || message.role === 'tool') return message

      const content = await Promise.all(
        message.content.map(async (part) => {
          if (!isImagePart(part)) return part
          changed = true
          return { type: 'text' as const, text: await imageFallbackText(part, signal) }
        })
      )
      return { ...message, content }
    })
  )

  return changed ? rewritten : null
}
