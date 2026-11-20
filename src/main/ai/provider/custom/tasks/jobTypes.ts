import type { ParamValues } from '@cherrystudio/provider-registry'
import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import type { UniqueModelId } from '@shared/data/types/model'

import type { ImageTransportDescriptor } from '../imageGenerationModel'

/**
 * Payload for the async image-generation job. Carries only what the handler
 * needs to build the submit input — NO secrets and NO raw
 * input-image bytes:
 *
 *   - `uniqueModelId` lets the handler re-resolve the provider/model and read
 *     the apiKey fresh from config on every attempt (never persisted).
 *   - Input images / mask are persisted as FileEntries at enqueue time and
 *     referenced by id, so the JSON payload stays under the 1MB job cap. Their
 *     `job_file_ref` rows keep them alive while the job is queued or running —
 *     the cleanup grace window alone does not cover a job that waits out a
 *     backlog (file-entry-cleanup.md §5.1).
 *   - `providerParams` is the canonical vendor bag split from catalog-validated
 *     `paramValues`. Native options and routing have their own payload fields;
 *     runtime callbacks are outside this persisted contract.
 */
export interface ImageGenerationJobPayload {
  uniqueModelId: UniqueModelId
  prompt?: string
  n: number
  size?: string
  aspectRatio?: string
  seed?: number
  inputFileIds?: string[]
  maskFileId?: string
  /** Per-model transport routing, derived in main from the registry — persisted
   *  here so the handler reaches the right endpoint / response family without
   *  re-resolving the registry. */
  modelDescriptor?: ImageTransportDescriptor
  /** Per-attempt submit timeout (ms); omitted uses the transport default. */
  requestTimeoutMs?: number
  /** Non-secret request source captured when the job is enqueued. */
  source?: SourceSnapshot
  providerParams: ParamValues
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
