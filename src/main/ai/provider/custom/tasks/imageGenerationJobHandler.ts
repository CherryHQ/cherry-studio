import type { ImageModelV3File } from '@ai-sdk/provider'
import { application } from '@application'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { loggerService } from '@logger'
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
import { resolveEffectiveEndpoint, resolveWireModelId } from '../../endpoint'
import { warnUnsupportedTransportInputs } from '../imageGenerationModel'
import type { ImageGenerationSubmitInput } from '../imageTransport'
import { isImageTransportConfig, resolveImageTransport } from '../imageTransportRegistry'
import { executeImageTransport } from '../imageTransportRuntime'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload } from './jobTypes'

const logger = loggerService.withContext('ImageGenerationJobHandler')

/**
 * Image-generation job handler for custom-provider transports. It resolves
 * durable inputs and persists outputs; `executeImageTransport` owns submit,
 * task-id persistence ordering, polling and remote cancellation.
 *
 * Secrets are never persisted — the apiKey is re-read from provider config on
 * every attempt via `resolveProviderAiSdkConfig`. Input images / mask are
 * referenced by FileEntry id and read back from FileManager, keeping the payload
 * under the 1MB job cap.
 *
 * **Deliberately not restart-durable.** The job's only consumer is the in-process
 * awaiter in `AiService.generateImageViaJob` (`await handle.finished`) — the sole
 * `handle.finished` in the main process; every other job type's result is a durable
 * side effect the handler writes itself. Nothing here designates a durable
 * destination: the payload records no consumer identity, so a result produced after
 * a restart reaches nobody. It would be downloaded, persisted as zero-referenced
 * `delete_when_unreferenced` entries, and reclaimed an hour later — and if the crash
 * landed after the vendor accepted the submit but before the task id was durable,
 * resuming would submit a second time and bill the user twice. So non-terminal jobs
 * are cancelled at startup (`recovery: 'abandon'`) instead of resumed.
 *
 * To make results survive a restart, do what `file-processing.remote-poll` does:
 * carry a durable destination in the payload (for paintings, the already-persisted
 * `painting.id` — the row exists before enqueue) and have this handler write the
 * result there, which registers `painting_file_ref` rows and makes GC correct for
 * free. Then switch `recovery` back to `'retry'` and restore the resume branch from
 * the recipe in `docs/references/job-and-scheduler/handler-authoring.md`.
 */
export const imageGenerationJobHandler: JobHandler<ImageGenerationJobPayload> = {
  recovery: 'abandon',
  defaultQueue: (input) => `image-generation.${parseUniqueModelId(input.uniqueModelId).providerId}`,
  defaultConcurrency: 2,
  // The transport already retries transient poll errors internally; a job-level
  // retry would re-submit and burn the user's vendor quota, so cap at 1 attempt
  // (parity with agent.task).
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const input = ctx.input
    const { providerId, modelId } = parseUniqueModelId(input.uniqueModelId)
    const provider = providerService.getByProviderId(providerId)
    if (!provider) throw new Error(`Image generation job: provider '${providerId}' not found`)
    const model = modelService.getByKey(providerId, modelId)
    if (!model) throw new Error(`Image generation job: model '${modelId}' not found for provider '${providerId}'`)

    const { config, credentialReceipt } = await resolveProviderAiSdkConfig(provider, model)
    const sdkConfig = {
      ...config,
      modelId: resolveWireModelId(model, resolveEffectiveEndpoint(provider, model).endpointType)
    }
    // Built fresh every execution and held in memory only. Upstream persists this
    // to job metadata so a resumed run can still attribute its cost; with
    // `recovery: 'abandon'` no run outlives the process, so persisting it would be
    // a write nobody reads — and would imply a durability this handler does not have.
    const captureContext = createAiUsageCaptureContext({
      providerId: provider.id,
      providerName: provider.name,
      modelId: sdkConfig.modelId,
      modelName: model.name,
      pricing: model.pricing,
      trustProviderReportedCost: provider.reportsActualCost,
      reportedCostCurrency: provider.reportedCostCurrency,
      credentialReceipt,
      source: input.source ?? null,
      messageRef: null
    })
    const usageStartedAt = Date.now()

    if (!isImageTransportConfig(sdkConfig, sdkConfig.modelId, input.modelDescriptor)) {
      throw new Error(`Image generation job: no transport for '${sdkConfig.providerId}' (model '${sdkConfig.modelId}')`)
    }
    const transport = await resolveImageTransport(sdkConfig, sdkConfig.modelId, input.modelDescriptor)
    if (!transport) {
      throw new Error(
        `Image generation job: no async transport for '${sdkConfig.providerId}' (model '${sdkConfig.modelId}')`
      )
    }

    const submitInput = await buildSubmitInput(input, sdkConfig.modelId, ctx.signal)
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
  modelId: string,
  signal: AbortSignal
): Promise<ImageGenerationSubmitInput<VendorBag>> {
  const files = input.inputFileIds?.length ? await Promise.all(input.inputFileIds.map(readImageFile)) : undefined
  const mask = input.maskFileId ? await readImageFile(input.maskFileId) : undefined
  return {
    modelId,
    prompt: input.prompt,
    n: input.n,
    size: input.size,
    aspectRatio: input.aspectRatio,
    seed: input.seed,
    files,
    mask,
    modelDescriptor: input.modelDescriptor,
    providerParams: input.providerParams,
    signal
  }
}

async function readImageFile(fileId: string): Promise<ImageModelV3File> {
  const { content, mime } = await application.get('FileManager').read(fileId, { encoding: 'base64' })
  return { type: 'file', mediaType: mime, data: content }
}

/** Resolve a transport result to a base64 data URL: inline `data:` results (from
 *  `b64_json`-style responses) are used as-is; anything else is downloaded. */
async function resolveImageDataUrl(url: string): Promise<Base64String | null> {
  if (url.startsWith('data:')) return url as Base64String
  const downloaded = await downloadImageAsBase64(url)
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
    const data = await resolveImageDataUrl(url)
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
