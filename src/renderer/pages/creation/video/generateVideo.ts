import type { FileMetadata } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file/fileEntry'

import { fileEntryToMetadata } from '../../paintings/utils/fileEntryAdapter'

/**
 * Renderer → main bridge for video generation. Mirrors `generatePainting`: partitions the
 * canonical form params into the AI SDK top-level video fields vs the vendor bag, encodes media
 * inputs to data URLs, calls `window.api.ai.generateVideo`, and adapts the persisted result
 * FileEntries to FileMetadata for display.
 */

/** Canonical video params the AI SDK / AiService accepts as top-level request fields. */
const TOP_LEVEL_KEYS = new Set(['duration', 'aspectRatio', 'resolution', 'fps', 'seed', 'negativePrompt'])

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime || 'image/png'};base64,${btoa(binary)}`
}

async function encodeMedia(entry: FileEntry): Promise<string> {
  const { data, mime } = await window.api.file.binaryImage(entry.id)
  return bytesToDataUrl(new Uint8Array(data), mime)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim())
  return undefined
}

export interface GenerateVideoInput {
  providerId: string
  modelId: string
  prompt: string
  firstFrame?: FileEntry
  lastFrame?: FileEntry
  /** Canonical video params from the settings form (resolution/aspectRatio/duration/seed/cfg/…). */
  params: Record<string, unknown>
  signal: AbortSignal
}

export async function generateVideoRequest(input: GenerateVideoInput): Promise<FileMetadata[]> {
  const top: Record<string, unknown> = {}
  const bag: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (value === undefined || value === '' || value === 'auto') continue
    if (TOP_LEVEL_KEYS.has(key)) top[key] = value
    else bag[key] = value
  }

  const duration = asNumber(top.duration)
  const fps = asNumber(top.fps)
  const seed = asNumber(top.seed)
  const firstFrame = input.firstFrame ? await encodeMedia(input.firstFrame) : undefined
  const lastFrame = input.lastFrame ? await encodeMedia(input.lastFrame) : undefined

  const requestId = crypto.randomUUID()
  const onAbort = () => window.api.ai.abortVideo(requestId)
  input.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await window.api.ai.generateVideo(
      {
        uniqueModelId: `${input.providerId}::${input.modelId}`,
        prompt: input.prompt,
        ...(firstFrame && { firstFrame }),
        ...(lastFrame && { lastFrame }),
        ...(duration !== undefined && { duration }),
        ...(typeof top.aspectRatio === 'string' && { aspectRatio: top.aspectRatio }),
        ...(typeof top.resolution === 'string' && { resolution: top.resolution }),
        ...(fps !== undefined && { fps }),
        ...(seed !== undefined && { seed }),
        ...(typeof top.negativePrompt === 'string' && top.negativePrompt && { negativePrompt: top.negativePrompt }),
        ...(Object.keys(bag).length > 0 && { providerOptions: { [input.providerId]: bag } })
      },
      requestId
    )
    if (input.signal.aborted) throw new DOMException('Video generation aborted', 'AbortError')
    return Promise.all(result.files.map(fileEntryToMetadata))
  } finally {
    input.signal.removeEventListener('abort', onAbort)
  }
}
