import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import type { UniqueModelId } from '@shared/data/types/model'

import type { ImageSizeToken } from '../../../utils/aiSdkNativeBindings'
import type { ImageTransportDescriptor } from '../imageGenerationModel'

/**
 * Payload for the image-generation job. Carries only what the handler needs to
 * build the submit input — NO secrets and NO raw
 * input-image bytes:
 *
 *   - `uniqueModelId` lets the handler re-resolve the provider/model and read
 *     the apiKey fresh from config on every attempt (never persisted).
 *   - Input images / mask are persisted as FileEntries at enqueue time and
 *     referenced by id, so the JSON payload stays under the 1MB job cap. Their
 *     `job_file_ref` rows keep them alive while the job is queued or running —
 *     the cleanup grace window alone does not cover a job that waits out a
 *     backlog (file-entry-cleanup.md §5.1).
 *   - `providerParams` is the canonical `vendorBag` from `splitParamValues` — the job
 *     path takes it raw, NOT the WireProfile engine's wire-named body (which is the
 *     in-SDK path's spelling). `VendorBag` pins that; see `imageOptions.ts`.
 */
export interface ImageGenerationJobPayload {
  uniqueModelId: UniqueModelId
  prompt?: string
  n: number
  /** `WxH` pixels OR a vendor shorthand (`1K`/`2K`/`4K`) — see {@link ImageSizeToken}.
   *  Declared as the token so the job path cannot re-assert `${number}x${number}`
   *  over a Seedream `2K` and hand a transport a `[NaN]` from `size.split('x')`. */
  size?: ImageSizeToken
  aspectRatio?: string
  seed?: number
  inputFileIds?: string[]
  maskFileId?: string
  /** Per-model transport routing, derived in main from the registry — persisted
   *  here so the handler reaches the right endpoint / response family without
   *  re-resolving the registry. */
  modelDescriptor?: ImageTransportDescriptor
  /** Non-secret request source captured when the job is enqueued. */
  source?: SourceSnapshot
  providerParams: VendorBag
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
