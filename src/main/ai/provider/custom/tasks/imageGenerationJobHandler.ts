import type { ImageModelV3File } from '@ai-sdk/provider'
import { application } from '@application'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { loggerService } from '@logger'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import type { GeneratedImageValidation } from '@shared/ai/paintingGenerateError'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import { parseUniqueModelId } from '@shared/data/types/model'

import { type GeneratedImageValidationResult, validateGeneratedImage } from '../../../utils/generatedImage'
import { resolveProviderAiSdkConfig } from '../../config'
import { resolveEffectiveEndpoint, resolveWireModelId } from '../../endpoint'
import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { resolveImageTransport } from '../imageTransportRegistry'
import { createAbortError } from '../transportUtils'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload } from './jobTypes'

const logger = loggerService.withContext('ImageGenerationJobHandler')

/**
 * Async image-generation handler for custom-provider submit/poll transports
 * (ppio / dashscope / modelscope / dmxapi-bespoke). Mirrors
 * `imageGenerationModel.doGenerate` but owns the submit/poll loop.
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

    const transport = resolveImageTransport(sdkConfig.providerId, sdkConfig.modelId, sdkConfig.providerSettings)
    if (!transport) {
      throw new Error(
        `Image generation job: no async transport for '${sdkConfig.providerId}' (model '${sdkConfig.modelId}')`
      )
    }

    // No persisted-task resume branch: `recovery: 'abandon'` means a job never
    // outlives the process that enqueued it, so every execution starts at submit.
    let urls: string[]
    const submit = await transport.submit(await buildSubmitInput(input, sdkConfig.modelId, ctx.signal))
    if (submit.imageUrls) {
      urls = submit.imageUrls
    } else if (submit.taskId) {
      urls = await pollUntilDone(transport, submit.taskId, ctx)
    } else {
      // A malformed submit response (neither URLs nor a task id) must fail the
      // job rather than silently complete with zero files (a paid no-op).
      throw new Error(`Image generation submit for '${sdkConfig.modelId}' returned neither imageUrls nor a taskId`)
    }

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

    // Preserve empty/rejected output as structured validation so both the painting
    // page and built-in tool can explain the paid no-op without parsing job errors.
    const output = await downloadAndPersistImageUrls(urls, ctx.signal, input.cleanupPolicy)
    ctx.reportProgress(100, { stage: 'done' })
    return output satisfies ImageGenerationJobOutput
  }
}

async function buildSubmitInput(
  input: ImageGenerationJobPayload,
  modelId: string,
  signal: AbortSignal
): Promise<ImageGenerationSubmitInput> {
  const files = input.inputFileIds?.length ? await Promise.all(input.inputFileIds.map(readImageFile)) : undefined
  const mask = input.maskFileId ? await readImageFile(input.maskFileId) : undefined
  return {
    modelId,
    prompt: input.prompt,
    n: input.n,
    size: input.size as `${number}x${number}` | undefined,
    aspectRatio: input.aspectRatio as `${number}:${number}` | undefined,
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

/**
 * Run the transport's poll loop, cancelling the remote task on job abort.
 * Mirrors the abort handling in `imageGenerationModel.doGenerate`.
 */
async function pollUntilDone(
  transport: ImageGenerationTransport,
  taskId: string,
  ctx: JobContext<ImageGenerationJobPayload>
): Promise<string[]> {
  if (!transport.poll) {
    throw new Error('Image transport returned a task id but does not implement polling')
  }
  const cancelRemote = transport.cancel ? () => void transport.cancel?.(taskId).catch(() => {}) : undefined
  if (cancelRemote) {
    if (ctx.signal.aborted) {
      cancelRemote()
      throw createAbortError('Image generation aborted')
    }
    ctx.signal.addEventListener('abort', cancelRemote, { once: true })
  }
  try {
    return await transport.poll(taskId, {
      signal: ctx.signal,
      onProgress: (progress) => ctx.reportProgress(progress, { stage: 'polling' }),
      // Carry the descriptor so the poll rebuilds per-task state on a transport
      // instance that did not run the submit (DashScope's response family).
      modelDescriptor: ctx.input.modelDescriptor
    })
  } finally {
    if (cancelRemote) ctx.signal.removeEventListener('abort', cancelRemote)
  }
}

/** Resolve a transport result to a base64 data URL: inline `data:` results (from
 *  `b64_json`-style responses) are used as-is; anything else is downloaded. */
type ResolvedImageDataUrl = GeneratedImageValidationResult | { downloadFailed: true }

async function resolveImageDataUrl(url: string): Promise<ResolvedImageDataUrl> {
  if (url.startsWith('data:')) {
    const separator = url.indexOf(',')
    const [mediaType, ...parameters] = url.slice(5, separator).split(';')
    if (separator < 0 || !mediaType || !parameters.includes('base64')) return { reason: 'invalid_image_data' }
    return validateGeneratedImage({ mediaType, base64: url.slice(separator + 1) })
  }
  const downloaded = await downloadImageAsBase64(url)
  return downloaded
    ? validateGeneratedImage({ mediaType: downloaded.media_type, base64: downloaded.data })
    : { downloadFailed: true }
}

/** Validate and persist result URLs as internal FileEntries. */
async function downloadAndPersistImageUrls(
  urls: string[],
  signal: AbortSignal,
  cleanupPolicy: CleanupPolicy
): Promise<ImageGenerationJobOutput> {
  const fileManager = application.get('FileManager')
  const files: FileEntry[] = []
  const rejected: GeneratedImageValidation['rejected'] = []
  let downloadFailures = 0
  for (const [index, url] of urls.entries()) {
    if (signal.aborted) throw createAbortError('Image generation aborted')
    const validated = await resolveImageDataUrl(url)
    if ('downloadFailed' in validated) {
      downloadFailures += 1
      continue
    }
    if (validated.reason) {
      rejected.push({ index, reason: validated.reason })
      continue
    }
    files.push(await fileManager.createInternalEntry({ source: 'base64', data: validated.data, cleanupPolicy }))
  }
  if (files.length === 0 && downloadFailures > 0) {
    throw new Error(`Image generation produced ${urls.length} URL(s) but all downloads failed`)
  }
  if (rejected.length > 0 || downloadFailures > 0) {
    logger.warn('Some generated image downloads failed', { requested: urls.length, persisted: files.length })
  }
  const validation = urls.length === 0 || rejected.length > 0 ? { receivedCount: urls.length, rejected } : undefined
  return { files, ...(validation && { validation }) }
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
