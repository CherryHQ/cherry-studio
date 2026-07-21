import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import type { UniqueModelId } from '@shared/data/types/model'

import type { ImageTransportDescriptor } from '../imageGenerationModel'

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
  /** Per-model transport routing, derived in main from the registry — persisted
   *  here so a restart-resume reaches the right endpoint / response family. */
  modelDescriptor?: ImageTransportDescriptor
  providerParams: Record<string, unknown>
  /** Stamped on the persisted output FileEntries — decided by the requesting business feature. */
  cleanupPolicy: CleanupPolicy
}

/** Job output — the persisted result FileEntries the IPC layer returns verbatim. */
export interface ImageGenerationJobOutput {
  files: FileEntry[]
}

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'image-generation.generate': ImageGenerationJobPayload
  }
}
