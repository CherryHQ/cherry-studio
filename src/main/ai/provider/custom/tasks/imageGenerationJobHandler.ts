import type { ImageModelV3File } from '@ai-sdk/provider'

import { application } from '@application'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { loggerService } from '@logger'
import { customFetch } from '@main/ai/utils/customFetch'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import type { JobHandler } from '@main/core/job/types'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Base64String } from '@shared/types/file'

import { resolveProviderAiSdkConfig } from '../../config'
import { warnUnsupportedTransportInputs } from '../imageGenerationModel'
import type { ImageGenerationSubmitInput } from '../imageTransport'
import { bindNativeImageTarget, createNativeImageTransport } from '../imageTransportRegistry'
import { executeImageTransport } from '../imageTransportRuntime'
import { imageJobConnectionKey } from './imageJobConnection'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload, ImageJobInput } from './jobTypes'

const logger = loggerService.withContext('ImageGenerationJobHandler')

/** Resolve the saved execution identity and inputs; the runtime owns remote task termination.
 *  Abandon on restart: the consumer is an in-process awaiter, not a durable delivery destination. */
export const imageGenerationJobHandler: JobHandler<ImageGenerationJobPayload> = {
  recovery: 'abandon',
  defaultQueue: (input) => `image-generation.${parseUniqueModelId(input.uniqueModelId).providerId}`,
  defaultConcurrency: 2,
  // Only query failures are retryable; retrying this handler could submit and bill twice.
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const input = ctx.input
    const { providerId, modelId } = parseUniqueModelId(input.uniqueModelId)
    const provider = providerService.getByProviderId(providerId)
    if (!provider) throw new Error(`Image generation job: provider '${providerId}' not found`)
    const model = modelService.getByKey(providerId, modelId)
    if (!model) throw new Error(`Image generation job: model '${modelId}' not found for provider '${providerId}'`)
    if (input.connectionKey !== imageJobConnectionKey(provider, model)) {
      throw new Error('Image generation connection changed while the job was queued; submit a new request')
    }

    const { config, credentialReceipt } = await resolveProviderAiSdkConfig(provider, model, {
      nativeImageTarget: input.target
    })
    // Attribution follows the credential selected for this invocation, not the enqueue-time rotation state.
    const captureContext = createAiUsageCaptureContext({
      providerId: provider.id,
      providerName: provider.name,
      modelId: input.modelId,
      modelName: model.name,
      pricing: model.pricing,
      trustProviderReportedCost: provider.reportsActualCost,
      reportedCostCurrency: provider.reportedCostCurrency,
      credentialReceipt,
      source: input.source ?? null,
      messageRef: null
    })
    const usageStartedAt = Date.now()

    const transport = await createNativeImageTransport(bindNativeImageTarget(input.target, config))

    const submitInput = await buildSubmitInput(input, ctx.signal)
    warnUnsupportedTransportInputs(transport, submitInput, { jobId: ctx.jobId, uniqueModelId: input.uniqueModelId })
    const urls = await executeImageTransport({
      transport,
      input: submitInput,
      // The handler does not resume abandoned jobs, but persisting the id before
      // the first query still leaves an accurate audit trail for cancellation.
      onTaskSubmitted: (taskId) => ctx.patchMetadata({ taskId }),
      onProgress: (progress) => ctx.reportProgress(progress, { stage: 'polling' }),
      logContext: { jobId: ctx.jobId, uniqueModelId: input.uniqueModelId }
    })

    // Record before local download: the provider invocation completed even if file
    // persistence fails. Polling is part of this invocation, not another billable
    // call; a successful zero-image response is still an observable invocation.
    if (captureContext) {
      const completedAt = Date.now()
      aiUsageRecordService.recordInvocation({
        requestId: `custom-image:${ctx.jobId}`,
        context: captureContext,
        modality: 'image',
        imageCount: urls.length,
        metrics: { timeCompletionMs: Math.max(0, completedAt - usageStartedAt) },
        completedAt
      })
    }

    const files = await downloadAndPersistImageUrls(urls, ctx.signal, input.cleanupPolicy)
    ctx.reportProgress(100, { stage: 'done' })
    return { files } satisfies ImageGenerationJobOutput
  }
}

async function buildSubmitInput(
  input: ImageGenerationJobPayload,
  signal: AbortSignal
): Promise<ImageGenerationSubmitInput<VendorBag>> {
  const files = input.inputImages.length ? await Promise.all(input.inputImages.map(readImageInput)) : undefined
  const mask = input.mask ? await readImageInput(input.mask) : undefined
  return {
    modelId: input.modelId,
    prompt: input.prompt,
    n: input.n,
    size: input.size,
    aspectRatio: input.aspectRatio,
    seed: input.seed,
    files,
    mask,
    modelDescriptor: input.target.modelDescriptor,
    providerParams: input.providerParams,
    headers: {},
    signal
  }
}

async function readImageInput(input: ImageJobInput): Promise<ImageModelV3File> {
  if (input.type === 'url') return input
  const { content, mime } = await application.get('FileManager').read(input.fileId, { encoding: 'base64' })
  return { type: 'file', mediaType: mime, data: content }
}

/** Resolve a transport result to a base64 data URL: inline `data:` results (from
 *  `b64_json`-style responses) are used as-is; anything else is downloaded. */
async function resolveImageDataUrl(url: string, signal: AbortSignal): Promise<Base64String | null> {
  if (url.startsWith('data:')) return url as Base64String
  const downloaded = await downloadImageAsBase64(url, { signal, fetch: customFetch })
  if (!downloaded) return null
  return `data:${downloaded.media_type || 'image/png'};base64,${downloaded.data}`
}

/** Persist result URLs (always non-empty — the caller guards) as internal FileEntries. */
async function downloadAndPersistImageUrls(
  urls: string[],
  signal: AbortSignal,
  cleanupPolicy: CleanupPolicy
): Promise<FileEntry[]> {
  const fileManager = application.get('FileManager')
  const files: FileEntry[] = []
  for (const url of urls) {
    if (signal.aborted) throw new DOMException('Image generation aborted', 'AbortError')
    const data = await resolveImageDataUrl(url, signal)
    if (signal.aborted) throw new DOMException('Image generation aborted', 'AbortError')
    if (!data) continue
    files.push(await fileManager.createInternalEntry({ source: 'base64', data, cleanupPolicy }))
  }
  // The remote generation succeeded (it returned URLs); surfacing a hard failure
  // when none could be downloaded avoids reporting a paid generation as an empty,
  // silent success. A partial failure still returns what we have, with a warning.
  if (files.length === 0) {
    throw new Error(`Image generation produced ${urls.length} URL(s) but all downloads failed`)
  }
  if (files.length < urls.length) {
    logger.warn('Some generated image downloads failed', { requested: urls.length, persisted: files.length })
  }
  return files
}

/**
 * Best-effort delete of temp image-input `file_entry` copies. Called by AiService
 * to clean up inputs it created when the job enqueue fails before the job owns
 * them. Once a job is enqueued its inputs are held by `job_file_ref`, and the
 * cleanup pass reclaims them when the job row is pruned — there is no ad-hoc
 * post-job delete (file-entry-cleanup.md §4.1/§5.1). Idempotent and non-throwing.
 */
export async function deleteImageInputEntries(ids: ReadonlyArray<string | undefined>): Promise<void> {
  const present = ids.filter((id): id is string => Boolean(id))
  if (present.length === 0) return
  const fileManager = application.get('FileManager')
  await Promise.all(
    present.map((id) =>
      fileManager.permanentDelete(id).catch((error) => logger.warn('Failed to delete image input entry', { id, error }))
    )
  )
}
