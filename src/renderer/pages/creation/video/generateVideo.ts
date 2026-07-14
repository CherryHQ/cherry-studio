import { buildVideoParamsSchema } from '@cherrystudio/provider-registry'
import { ipcApi } from '@renderer/ipc'
import type { FileMetadata } from '@renderer/types/file'
import type { FileEntry } from '@shared/data/types/file'
import type { VideoGenerationMode, VideoGenerationSupport } from '@shared/data/types/model'

import { fileEntryToMetadata } from '../image/utils/fileEntryAdapter'

/**
 * Renderer → main bridge for video generation. Mirrors `canonicalGenerate` →
 * `generatePainting`: validates / coerces the raw form params through the central
 * video catalog (`buildVideoParamsSchema`), ships the whole canonical bag as
 * `paramValues` to the `ai.generate_video` IpcApi route, encodes media inputs to
 * data URLs, and adapts the persisted result FileEntries to FileMetadata for
 * display. main owns the native-vs-vendor partition (`splitVideoParamValues`)
 * and the per-vendor wire mapping — the renderer stays vendor-agnostic.
 */

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime || 'image/png'};base64,${btoa(binary)}`
}

async function encodeMedia(entry: FileEntry): Promise<string> {
  const { data, mime } = await window.api.file.binaryImage(entry.id)
  return bytesToDataUrl(new Uint8Array(data), mime)
}

export interface GenerateVideoInput {
  providerId: string
  modelId: string
  prompt: string
  firstFrame?: FileEntry
  lastFrame?: FileEntry
  /** Canonical video params from the settings form (resolution/aspectRatio/duration/seed/cfg/…). */
  params: Record<string, unknown>
  /** The model's registry `videoGeneration` block — per-model option/range constraints. */
  support?: VideoGenerationSupport
  /** The active generation mode (which supports block validates). */
  mode?: VideoGenerationMode
  signal: AbortSignal
}

export async function generateVideoRequest(input: GenerateVideoInput): Promise<FileMetadata[]> {
  // Validate / coerce raw form params through the central catalog. Soft-fail: a
  // bad / stale value must never break submit, so fall back to raw params — the
  // strict IPC boundary schema (`videoParamsSchema`) is the hard gate.
  const rawParams = input.params ?? {}
  const validated = buildVideoParamsSchema(input.support, input.mode).safeParse(rawParams)
  const source: Record<string, unknown> = validated.success ? validated.data : rawParams

  // Build the canonical `paramValues` bag: drop blanks (mirrors main's
  // `splitVideoParamValues` guard) so the server applies its own defaults.
  const paramValues: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === '' || value === null) continue
    paramValues[key] = value
  }

  const firstFrame = input.firstFrame ? await encodeMedia(input.firstFrame) : undefined
  const lastFrame = input.lastFrame ? await encodeMedia(input.lastFrame) : undefined

  const requestId = crypto.randomUUID()
  const onAbort = () => void ipcApi.request('ai.abort_video', { requestId })
  input.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await ipcApi.request('ai.generate_video', {
      requestId,
      payload: {
        uniqueModelId: `${input.providerId}::${input.modelId}`,
        prompt: input.prompt,
        ...(firstFrame && { firstFrame }),
        ...(lastFrame && { lastFrame }),
        paramValues
      }
    })
    if (input.signal.aborted) throw new DOMException('Video generation aborted', 'AbortError')
    return Promise.all(result.files.map(fileEntryToMetadata))
  } finally {
    input.signal.removeEventListener('abort', onAbort)
  }
}
