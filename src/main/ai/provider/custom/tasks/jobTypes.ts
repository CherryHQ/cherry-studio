import type { ImageModelV3File } from '@ai-sdk/provider'
import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import type { UniqueModelId } from '@shared/data/types/model'

import type { ImageSizeToken } from '../../../utils/aiSdkNativeBindings'
import type { NativeImageTarget } from '../imageTransportRegistry'

export type ImageJobInput = Extract<ImageModelV3File, { type: 'url' }> | { type: 'file'; fileId: FileEntry['id'] }

/** Prepared protocol and canonical parameters, without credentials or inline image bytes.
 *  URL inputs keep their protocol representation; local copies are held by job_file_ref. */
export interface ImageGenerationJobPayload {
  uniqueModelId: UniqueModelId
  modelId: string
  connectionKey: string
  prompt?: string
  n: number
  /** Pixels or a vendor shorthand; the protocol owns final encoding. */
  size?: ImageSizeToken
  aspectRatio?: string
  seed?: number
  inputImages: ImageJobInput[]
  mask: ImageJobInput | undefined
  /** Per-model transport routing, derived in main from the registry — persisted
   *  here so the handler reaches the right endpoint / response family without
   *  re-resolving the registry. */
  target: NativeImageTarget
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
