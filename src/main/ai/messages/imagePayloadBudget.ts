import { setImmediate } from 'node:timers/promises'

import type { LanguageModelV3Prompt, LanguageModelV3ToolResultOutput } from '@ai-sdk/provider'

import { loggerService } from '@logger'
import { CHAT_IMAGE_BUDGET_BYTES } from '@shared/ai/chatImageBudget'
import { parseDataUrl } from '@shared/utils/dataUrl'

import { isReplayUserMessage } from '../provider/replayRoute'

const logger = loggerService.withContext('ai:imagePayloadBudget')
const JPEG_LADDER = [
  { edge: 1280, quality: 80 },
  { edge: 768, quality: 65 },
  { edge: 384, quality: 45 }
]
const MIN_IMAGE_EDGE = 15
const MAX_INPUT_PIXELS = 24_000_000
const MAX_INPUT_BYTES = 32_000_000
const MAX_IMAGES_TO_ENCODE = 8
const ENCODE_DEADLINE_MS = 250
const MAX_CONCURRENT_ENCODES = 2
let activeEncodes = 0

type ToolContent = Extract<LanguageModelV3ToolResultOutput, { type: 'content' }>['value'][number]
type InlineImage = string | Uint8Array

interface PromptImage {
  data?: InlineImage
  current?: boolean
  replace: (jpeg?: Buffer) => void
}

interface CountedImage extends PromptImage {
  bytes: number
  jpeg?: Buffer
}

const isImage = (mediaType?: string) => mediaType?.toLowerCase().startsWith('image/') === true

function toolImageData(item: ToolContent): InlineImage | null | undefined {
  if (item.type === 'image-data' || (item.type === 'file-data' && isImage(item.mediaType))) return item.data
  if (item.type === 'image-file-id') return null
  if (item.type === 'image-url' || (item.type === 'file-url' && isImage(item.mediaType))) {
    const parsed = parseDataUrl(item.url)
    return parsed?.isBase64 ? parsed.data : null
  }
  return undefined
}

function omittedImage(filename?: string) {
  const label = filename ? ` ${JSON.stringify(filename)}` : ''
  return { type: 'text' as const, text: `[Image${label} omitted to fit the chat image budget]` }
}

function* promptImages(
  prompt: LanguageModelV3Prompt,
  outbound: LanguageModelV3Prompt,
  currentImageCount: number
): Generator<PromptImage | undefined> {
  const currentUser = prompt.findLastIndex(isReplayUserMessage)
  for (const [messageIndex, message] of prompt.entries()) {
    if (message.role === 'system') {
      yield
      continue
    }
    let copiedContent: typeof message.content | undefined
    const editContent = () => {
      if (!copiedContent) {
        copiedContent = message.content.slice()
        outbound[messageIndex] = { ...message, content: copiedContent } as typeof message
      }
      return copiedContent
    }
    // Adjacent user messages can coalesce. Only the trailing current user files are protected.
    let historyImages = 0
    if (messageIndex === currentUser) {
      for (const part of message.content) {
        if (part.type === 'file' && isImage(part.mediaType)) historyImages++
        yield
      }
      historyImages -= currentImageCount
    }
    for (const [partIndex, part] of message.content.entries()) {
      if (part.type === 'file' && isImage(part.mediaType)) {
        yield {
          data: part.data instanceof URL ? undefined : part.data,
          current: messageIndex === currentUser && historyImages-- <= 0,
          replace: (jpeg) => {
            editContent()[partIndex] = jpeg
              ? { ...part, mediaType: 'image/jpeg', data: jpeg }
              : omittedImage(part.filename)
          }
        }
      } else if (part.type === 'tool-result' && part.output.type === 'content') {
        const output = part.output
        let copiedValue: ToolContent[] | undefined
        for (const [itemIndex, item] of output.value.entries()) {
          const data = toolImageData(item)
          yield data === undefined
            ? undefined
            : {
                data: data ?? undefined,
                replace: (jpeg) => {
                  if (!copiedValue) {
                    copiedValue = output.value.slice()
                    editContent()[partIndex] = { ...part, output: { ...output, value: copiedValue } }
                  }
                  copiedValue[itemIndex] = jpeg
                    ? {
                        ...item,
                        type: item.type === 'file-data' ? 'file-data' : 'image-data',
                        mediaType: 'image/jpeg',
                        data: jpeg.toString('base64')
                      }
                    : omittedImage(item.type === 'file-data' ? item.filename : undefined)
                }
              }
        }
      }
      yield
    }
    yield
  }
}

async function encodeJpeg(
  input: Buffer,
  edge: number,
  quality: number,
  signal: AbortSignal
): Promise<Buffer | undefined> {
  activeEncodes++
  try {
    const { default: sharp } = await import('sharp')
    if (signal.aborted) return undefined
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .autoOrient()
      .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' })
      .jpeg({ quality })
      .timeout({ seconds: 1 })
      .toBuffer({ resolveWithObject: true })
    return info.width >= MIN_IMAGE_EDGE && info.height >= MIN_IMAGE_EDGE ? data : undefined
  } catch (error) {
    logger.debug('Could not resize a prompt image', { error })
    return undefined
  } finally {
    activeEncodes--
  }
}

export async function enforceImagePayloadBudget(
  prompt: LanguageModelV3Prompt,
  currentImageCount: number,
  signal: AbortSignal,
  budgetBytes = CHAT_IMAGE_BUDGET_BYTES
): Promise<{ prompt: LanguageModelV3Prompt; reducedCount: number; omittedCount: number }> {
  signal.throwIfAborted()
  const outbound = prompt.slice()
  const images: CountedImage[] = []
  const encodable: CountedImage[] = []
  let opaqueCurrent = false
  let currentBytes = 0
  let totalBytes = 0
  let reducedCount = 0
  let omittedCount = 0
  let scanned = 0
  for (const image of promptImages(prompt, outbound, currentImageCount)) {
    if (++scanned % 256 === 0) {
      await setImmediate()
      signal.throwIfAborted()
    }
    if (!image) continue
    if (image.data === undefined) {
      if (image.current) opaqueCurrent = true
      else {
        image.replace()
        omittedCount++
      }
      continue
    }
    const bytes = typeof image.data === 'string' ? Buffer.byteLength(image.data, 'base64') : image.data.byteLength
    totalBytes += bytes
    if (image.current) currentBytes += bytes
    else {
      const counted = { ...image, bytes }
      images.push(counted)
      if (bytes <= MAX_INPUT_BYTES && encodable.length < MAX_IMAGES_TO_ENCODE) encodable.push(counted)
    }
  }

  const limit = opaqueCurrent ? currentBytes : Math.max(budgetBytes, currentBytes)
  if (totalBytes > limit && limit > currentBytes) {
    const stopAt = performance.now() + ENCODE_DEADLINE_MS
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(ENCODE_DEADLINE_MS)])
    const canEncode = () => !deadline.aborted && performance.now() < stopAt && activeEncodes < MAX_CONCURRENT_ENCODES
    let stop!: () => void
    const stopped = new Promise<undefined>((resolve) => {
      stop = () => resolve(undefined)
      deadline.addEventListener('abort', stop, { once: true })
    })
    try {
      for (const image of encodable) {
        if (totalBytes <= limit || !canEncode()) break
        if (!image.data) continue
        const input =
          typeof image.data === 'string'
            ? Buffer.from(image.data, 'base64')
            : Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
        for (const { edge, quality } of JPEG_LADDER) {
          if (!canEncode()) break
          const jpeg = await Promise.race([encodeJpeg(input, edge, quality, deadline), stopped])
          signal.throwIfAborted()
          if (!jpeg || jpeg.length >= image.bytes) continue
          totalBytes -= image.bytes - jpeg.length
          image.bytes = jpeg.length
          image.jpeg = jpeg
          if (totalBytes <= limit) break
        }
      }
    } finally {
      deadline.removeEventListener('abort', stop)
    }
  }

  for (const [index, image] of images.entries()) {
    if (index && index % 256 === 0) {
      await setImmediate()
      signal.throwIfAborted()
    }
    if (totalBytes > limit) {
      totalBytes -= image.bytes
      image.replace()
      omittedCount++
    } else if (image.jpeg) {
      image.replace(image.jpeg)
      reducedCount++
    }
  }

  return { prompt: reducedCount || omittedCount ? outbound : prompt, reducedCount, omittedCount }
}
