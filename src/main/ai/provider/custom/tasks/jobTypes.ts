import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { UniqueModelId } from '@shared/data/types/model'

/**
 * Payload for the async image-generation job. Carries only what the handler
 * needs to (re)build the submit input after a restart — NO secrets and NO raw
 * input-image bytes:
 *
 *   - `uniqueModelId` lets the handler re-resolve the provider/model and read
 *     the apiKey fresh from config on every attempt (never persisted).
 *   - Input images / mask are persisted as FileEntries at enqueue time and
 *     referenced by id, so the JSON payload stays under the 1MB job cap and the
 *     bytes survive a restart-resume.
 *   - `providerParams` is `imageProviderOptions[sdkConfig.providerId]` — the
 *     exact bag the in-SDK path hands `transport.submit` (JSON-only; the
 *     plugin-chain callbacks like `onProgress` are already stripped).
 */
export interface ImageGenerationJobPayload {
  uniqueModelId: UniqueModelId
  prompt?: string
  n: number
  size?: string
  seed?: number
  inputFileIds?: string[]
  maskFileId?: string
  providerParams: Record<string, unknown>
}

/** Job output — the persisted result FileEntries the IPC layer returns verbatim. */
export interface ImageGenerationJobOutput {
  files: FileEntry[]
}

/**
 * Payload for the async video-generation job (aggregator submit/poll transports —
 * DMXAPI / PPIO / AiHubMix). Same restart-safety contract as image: no secrets, media
 * inputs persisted as FileEntries and referenced by id, `uniqueModelId` re-resolves the
 * provider/model + fresh apiKey on every attempt. `providerParams` is the mapped vendor
 * bag (`buildVideoProviderOptions[sdkConfig.providerId]`).
 */
export interface VideoGenerationJobPayload {
  uniqueModelId: UniqueModelId
  prompt?: string
  firstFrameFileId?: string
  lastFrameFileId?: string
  referenceImageFileIds?: string[]
  inputVideoFileId?: string
  inputAudioFileId?: string
  providerParams: Record<string, unknown>
}

/** Job output — the persisted result video FileEntries the IPC layer returns verbatim. */
export interface VideoGenerationJobOutput {
  files: FileEntry[]
}

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'image-generation.generate': ImageGenerationJobPayload
    'video-generation.generate': VideoGenerationJobPayload
  }
}
