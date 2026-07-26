import type { VendorBag } from '@main/ai/utils/imageOptions'
import type { FileEntry } from '@shared/data/types/file'
import type { UniqueModelId } from '@shared/data/types/model'

import type { ImageSizeToken } from '../../../utils/aiSdkNativeBindings'
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
 *   - `providerParams` is the canonical `vendorBag` from `splitParamValues` — the job
 *     path takes it raw, NOT the WireProfile engine's wire-named body (which is the
 *     in-SDK path's spelling). `VendorBag` pins that; see `imageOptions.ts`.
 */
export interface ImageGenerationJobPayload {
  uniqueModelId: UniqueModelId
  prompt?: string
  n: number
  /** `WxH` pixels OR a vendor shorthand (`1K`/`2K`/`4K`) — see {@link ImageSizeToken}.
   *  Declared as the token so the resume path cannot re-assert `${number}x${number}`
   *  over a Seedream `2K` and hand a transport a `[NaN]` from `size.split('x')`. */
  size?: ImageSizeToken
  aspectRatio?: string
  seed?: number
  inputFileIds?: string[]
  maskFileId?: string
  /** Per-model transport routing, derived in main from the registry — persisted
   *  here so a restart-resume reaches the right endpoint / response family. */
  modelDescriptor?: ImageTransportDescriptor
  providerParams: VendorBag
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
