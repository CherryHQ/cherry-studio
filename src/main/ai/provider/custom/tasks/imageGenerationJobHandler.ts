import type { ImageModelV3File } from '@ai-sdk/provider'

import { application } from '@application'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import type { JobContext, JobHandler, JobSettledEvent } from '@main/core/job/types'
import { modelService } from '@main/data/services/ModelService'
import { paintingService } from '@main/data/services/PaintingService'
import { providerService } from '@main/data/services/ProviderService'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import { imageConfigProtocol } from '@shared/ai/imageGenerationConfig'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'
import type { CleanupPolicy, FileEntry } from '@shared/data/types/file'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Base64String } from '@shared/types/file'

import { resolveProviderAiSdkConfig } from '../../config'
import { resolveEffectiveEndpoint, resolveWireModelId } from '../../endpoint'
import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'
import { resolveImageTransport } from '../imageTransportRegistry'
import { createAbortError } from '../transportUtils'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload } from './jobTypes'

const logger = loggerService.withContext('ImageGenerationJobHandler')

function paintingIdFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const id = (input as { paintingId?: unknown }).paintingId
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Run during AI initialization, before any current-process generation starts. */
export function reconcileImageGenerationJobs(): void {
  const jobs = jobService.list({ type: 'image-generation.generate', status: ['pending', 'delayed', 'running'] })
  const activePaintingIds = new Set<string>()
  const abandonedIds: string[] = []
  for (const job of jobs) {
    const paintingId = paintingIdFromInput(job.input)
    const resumable =
      readResumableImageUrls(job.metadata.imageUrls) ||
      (typeof job.metadata.taskId === 'string' && job.metadata.taskId.length > 0)
    const unsubmitted = job.startedAt === null && job.metadata.submissionStarted !== true
    if (paintingId && !job.cancelRequested && (resumable || unsubmitted)) {
      activePaintingIds.add(paintingId)
    } else {
      abandonedIds.push(job.id)
    }
  }
  jobService.cancelByIds(abandonedIds, {
    code: JOB_ERROR_CODES.CANCELLED,
    message: 'Interrupted image generation cannot be safely resumed',
    retryable: false
  })
  paintingService.markOrphanedRunningSteps(activePaintingIds)
}

export async function cancelImageGenerationJobs(paintingIds: ReadonlySet<string>): Promise<void> {
  const jobs = jobService.list({ type: 'image-generation.generate', status: ['pending', 'delayed', 'running'] })
  const manager = application.get('JobManager')
  await Promise.all(
    jobs
      .filter((job) => {
        const id = paintingIdFromInput(job.input)
        return id !== undefined && paintingIds.has(id)
      })
      .map((job) => manager.cancel(job.id, 'painting cancelled'))
  )
}

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
 * Painting requests carry their persisted step id as a durable destination. The
 * handler stores a remote task id (or a small URL list) in job metadata before
 * polling/downloading, so startup recovery can continue without resubmitting.
 * Startup reconciliation abandons calls without a durable destination and
 * submissions whose remote outcome is unknown instead of spending quota twice.
 */
export const imageGenerationJobHandler: JobHandler<ImageGenerationJobPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => `image-generation.${parseUniqueModelId(input.uniqueModelId).providerId}`,
  defaultConcurrency: 2,
  // The transport already retries transient poll errors internally; a job-level
  // retry would re-submit and burn the user's vendor quota, so cap at 1 attempt
  // (parity with agent.task).
  defaultRetryPolicy: {
    maxAttempts: 1,
    backoff: 'none',
    baseDelayMs: 0,
    maxDelayMs: 0
  },
  defaultTimeoutMs: 30 * 60_000,
  async onSettled(event: JobSettledEvent<ImageGenerationJobPayload>) {
    const paintingId = event.input.paintingId
    if (!paintingId) return
    try {
      const painting = paintingService.getById(paintingId)
      if (painting.stepStatus !== 'running') return
      if (event.status === 'completed') {
        const output = event.output as ImageGenerationJobOutput | null | undefined
        const files = output?.files ?? []
        if (files.length === 0) {
          paintingService.update(paintingId, {
            stepStatus: 'failed',
            stepError: 'Image generation returned no images'
          })
          return
        }
        paintingService.update(paintingId, {
          stepStatus: 'completed',
          stepError: null,
          files: {
            output: files.map((file) => file.id),
            input: painting.files.input
          }
        })
        return
      }
      paintingService.update(paintingId, {
        stepStatus: event.status === 'cancelled' ? 'canceled' : 'failed',
        stepError: event.status === 'cancelled' ? null : (event.error?.message ?? 'Image generation failed')
      })
    } catch (error) {
      logger.warn('Failed to reconcile terminal painting job', {
        paintingId,
        status: event.status,
        error
      })
    }
  },
  async execute(ctx) {
    const input = ctx.input
    const { providerId, modelId } = parseUniqueModelId(input.uniqueModelId)
    const provider = providerService.getByProviderId(providerId)
    if (!provider) throw new Error(`Image generation job: provider '${providerId}' not found`)
    const model = modelService.getByKey(providerId, modelId)
    if (!model) throw new Error(`Image generation job: model '${modelId}' not found for provider '${providerId}'`)

    const imageEndpoint = input.inputFileIds?.length ? 'openai-image-edit' : 'openai-image-generation'
    const resolvedEndpoint = resolveEffectiveEndpoint(
      provider,
      provider.endpointConfigs?.[imageEndpoint] ? { ...model, endpointTypes: [imageEndpoint] } : model
    )
    const { config, credentialReceipt } = await resolveProviderAiSdkConfig(provider, model, { resolvedEndpoint })
    const sdkConfig = {
      ...config,
      modelId: resolveWireModelId(model, resolvedEndpoint.endpointType)
    }
    // Built fresh every execution and held in memory only. A resumed job creates
    // a fresh usage capture context for the resumed provider attempt.
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

    const transport = resolveImageTransport(
      imageConfigProtocol(model.imageGenerationConfig) ?? provider.presetProviderId ?? sdkConfig.providerId,
      sdkConfig.modelId,
      sdkConfig.providerSettings
    )
    if (!transport) {
      throw new Error(
        `Image generation job: no async transport for '${sdkConfig.providerId}' (model '${sdkConfig.modelId}')`
      )
    }

    const metadataUrls = readResumableImageUrls(ctx.metadata.imageUrls)
    const metadataTaskId = typeof ctx.metadata.taskId === 'string' ? ctx.metadata.taskId : undefined
    let urls: string[]
    if (metadataUrls) {
      urls = metadataUrls
    } else if (metadataTaskId) {
      urls = await pollUntilDone(transport, metadataTaskId, ctx)
    } else {
      if (ctx.metadata.submissionStarted === true)
        throw new Error('The previous image submission has an unknown outcome; it will not be submitted again')
      const submitInput = await buildSubmitInput(input, sdkConfig.modelId, ctx.signal)
      if (ctx.signal.aborted) throw createAbortError('Image generation aborted')
      await ctx.patchMetadata({ submissionStarted: true })
      if (ctx.signal.aborted) throw createAbortError('Image generation aborted')
      const submit = await transport.submit(submitInput)
      if (submit.imageUrls) {
        urls = submit.imageUrls
        if (isResumableImageUrls(urls)) await ctx.patchMetadata({ imageUrls: urls })
      } else if (submit.taskId) {
        await ctx.patchMetadata({ taskId: submit.taskId })
        urls = await pollUntilDone(transport, submit.taskId, ctx)
      } else {
        // A malformed submit response (neither URLs nor a task id) must fail the
        // job rather than silently complete with zero files (a paid no-op).
        throw new Error(`Image generation submit for '${sdkConfig.modelId}' returned neither imageUrls nor a taskId`)
      }
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
        metrics: {
          timeCompletionMs: Math.max(0, completedAt - usageStartedAt)
        },
        completedAt
      })
    }

    // An empty URL list from a *successful* submit/poll (e.g. content moderation
    // or a degraded vendor response that still charged) must fail rather than
    // complete as a silent zero-image "success". Covers both submit.imageUrls === []
    // and poll() === []; the malformed-submit (neither field) case threw above.
    // Recorded above with imageCount=0 because the provider invocation did complete.
    if (urls.length === 0) {
      throw new Error(`Image generation for '${sdkConfig.modelId}' completed but returned no image URLs`)
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
async function resolveImageDataUrl(url: string): Promise<Base64String | null> {
  if (url.startsWith('data:')) return url as Base64String
  const downloaded = await downloadImageAsBase64(url)
  if (!downloaded) return null
  return `data:${downloaded.media_type || 'image/png'};base64,${downloaded.data}`
}

function isResumableImageUrls(value: readonly string[]): boolean {
  if (value.length === 0 || value.some((url) => url.startsWith('data:'))) return false
  try {
    return JSON.stringify(value).length <= 200_000
  } catch {
    return false
  }
}

function readResumableImageUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((url): url is string => typeof url === 'string')) return undefined
  return isResumableImageUrls(value) ? [...value] : undefined
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
    if (signal.aborted) throw createAbortError('Image generation aborted')
    const data = await resolveImageDataUrl(url)
    if (!data) continue
    files.push(
      await fileManager.createInternalEntry({
        source: 'base64',
        data,
        cleanupPolicy
      })
    )
  }
  // The remote generation succeeded (it returned URLs); surfacing a hard failure
  // when none could be downloaded avoids reporting a paid generation as an empty,
  // silent success. A partial failure still returns what we have, with a warning.
  if (files.length === 0) {
    throw new Error(`Image generation produced ${urls.length} URL(s) but all downloads failed`)
  }
  if (files.length < urls.length) {
    logger.warn('Some generated image downloads failed', {
      requested: urls.length,
      persisted: files.length
    })
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
