import type { ImageModelV3File } from '@ai-sdk/provider'
import { application } from '@application'
import {
  type AiUsageCaptureContext,
  aiUsageRecordService,
  createAiUsageCaptureContext
} from '@data/services/aiUsageRecord'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import type { FileEntry } from '@shared/data/types/file'
import { parseUniqueModelId } from '@shared/data/types/model'

import { resolveProviderAiSdkConfig } from '../../config'
import type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportDescriptor
} from '../imageGenerationModel'
import { resolveImageTransport } from '../imageTransportRegistry'
import { createAbortError } from '../transportUtils'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload } from './jobTypes'

const logger = loggerService.withContext('ImageGenerationJobHandler')

/**
 * Async image-generation handler for custom-provider submit/poll transports
 * (ppio / dashscope / modelscope / dmxapi-bespoke). Mirrors
 * `imageGenerationModel.doGenerate` but owns the poll loop so it survives a
 * restart: the remote `taskId` is persisted to job metadata after submit, and
 * recovery (`'retry'`) re-dispatches the job, which then resumes polling the
 * same task instead of re-submitting.
 *
 * Secrets are never persisted — the apiKey is re-read from provider config on
 * every attempt via `resolveProviderAiSdkConfig`. Input images / mask are referenced
 * by FileEntry id and read back from FileManager (keeps the payload under the
 * 1MB job cap and restart-safe).
 */
export const imageGenerationJobHandler: JobHandler<ImageGenerationJobPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => `image-generation.${parseUniqueModelId(input.uniqueModelId).providerId}`,
  defaultConcurrency: 2,
  // The transport already retries transient poll errors internally; a job-level
  // retry would re-submit and burn the user's vendor quota, so cap at 1 attempt
  // (parity with agent.task).
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const input = ctx.input
    try {
      const { providerId, modelId } = parseUniqueModelId(input.uniqueModelId)
      const provider = providerService.getByProviderId(providerId)
      if (!provider) throw new Error(`Image generation job: provider '${providerId}' not found`)
      const model = modelService.getByKey(providerId, modelId)
      if (!model) throw new Error(`Image generation job: model '${modelId}' not found for provider '${providerId}'`)

      const { config, credentialReceipt: selectedCredentialReceipt } = await resolveProviderAiSdkConfig(provider, model)
      const sdkConfig = { ...config, modelId: model.apiModelId ?? model.id }
      const persistedTaskId = typeof ctx.metadata.taskId === 'string' ? ctx.metadata.taskId : undefined
      const persistedCaptureContext = readCaptureContext(ctx.metadata.usageCaptureContext)
      const captureContext = persistedTaskId
        ? persistedCaptureContext
        : createAiUsageCaptureContext({
            providerId: provider.id,
            providerName: provider.name,
            modelId: sdkConfig.modelId,
            modelName: model.name,
            pricing: model.pricing,
            trustProviderReportedCost: provider.apiFeatures.reportsActualCost,
            credentialReceipt: selectedCredentialReceipt,
            source: input.source ?? null,
            messageRef: null
          })
      const usageStartedAt = persistedTaskId
        ? typeof ctx.metadata.usageStartedAt === 'number' && Number.isFinite(ctx.metadata.usageStartedAt)
          ? ctx.metadata.usageStartedAt
          : Date.now()
        : Date.now()
      if (!persistedTaskId) {
        await ctx.patchMetadata({
          usageCaptureContext: captureContext,
          usageStartedAt,
          credentialReceipt: selectedCredentialReceipt
        })
      } else if (!captureContext) {
        logger.warn('Resumed image job has no immutable usage context; skipping attribution', {
          jobId: ctx.jobId,
          taskId: persistedTaskId
        })
      }
      const transport = resolveImageTransport(sdkConfig.providerId, sdkConfig.modelId, sdkConfig.providerSettings)
      if (!transport) {
        throw new Error(
          `Image generation job: no async transport for '${sdkConfig.providerId}' (model '${sdkConfig.modelId}')`
        )
      }

      let urls: string[]
      if (persistedTaskId) {
        // Restart-resume: skip submit, continue polling the persisted remote task.
        logger.debug('Resuming image-generation job from persisted task', { jobId: ctx.jobId, taskId: persistedTaskId })
        urls = await pollUntilDone(transport, persistedTaskId, ctx)
      } else {
        const submit = await transport.submit(await buildSubmitInput(input, sdkConfig.modelId, ctx.signal))
        if (submit.imageUrls) {
          urls = submit.imageUrls
        } else if (submit.taskId) {
          // CRITICAL: persist before polling — without this, restart-recovery
          // re-submits, wasting the user's vendor quota.
          await ctx.patchMetadata({
            taskId: submit.taskId,
            credentialReceipt: selectedCredentialReceipt
          })
          urls = await pollUntilDone(transport, submit.taskId, ctx)
        } else {
          // A malformed submit response (neither URLs nor a task id) must fail the
          // job rather than silently complete with zero files (a paid no-op).
          throw new Error(`Image generation submit for '${sdkConfig.modelId}' returned neither imageUrls nor a taskId`)
        }
      }

      // Record before local download: the provider invocation completed even if
      // file persistence fails. Polling is part of this invocation, not another
      // billable call; a successful zero-image response is still an observable
      // invocation. The stable job id keeps restart delivery idempotent.
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

      // An empty URL list from a *successful* submit/poll (e.g. content moderation
      // or a degraded vendor response that still charged) must fail rather than
      // complete as a silent zero-image "success". It was recorded above with
      // imageCount=0 because the provider invocation itself did complete.
      if (urls.length === 0) {
        throw new Error(`Image generation for '${sdkConfig.modelId}' completed but returned no image URLs`)
      }

      const files = await downloadAndPersistImageUrls(urls, ctx.signal)
      ctx.reportProgress(100, { stage: 'done' })
      return { files } satisfies ImageGenerationJobOutput
    } finally {
      // Best-effort cleanup of the per-job temp input/mask copies. Owned by the
      // handler so it also covers the restart-resume path (the original IPC
      // `finally` is gone after a restart). Safe: resume polls from the persisted
      // taskId and never re-reads these ids.
      await deleteImageInputEntries([...(input.inputFileIds ?? []), input.maskFileId])
    }
  }
}

function readCaptureContext(value: unknown): AiUsageCaptureContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const context = value as Partial<AiUsageCaptureContext>
  if (
    typeof context.providerId !== 'string' ||
    typeof context.modelId !== 'string' ||
    typeof context.trustProviderReportedCost !== 'boolean' ||
    !context.credentialReceipt
  ) {
    return undefined
  }
  const cloned = structuredClone(context) as AiUsageCaptureContext
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return
    for (const nested of Object.values(candidate)) freeze(nested)
    Object.freeze(candidate)
  }
  freeze(cloned)
  return cloned
}

/**
 * Jobs enqueued before `modelDescriptor` became a typed payload field carried
 * it inside the vendor bag instead (`providerParams.modelDescriptor`). A job
 * still queued (or mid-poll) across that upgrade resumes with the new field
 * absent — fall back to the legacy bag location so PPIO/DashScope submit/poll
 * still route correctly.
 */
function resolveModelDescriptor(input: ImageGenerationJobPayload): ImageTransportDescriptor | undefined {
  return input.modelDescriptor ?? (input.providerParams?.modelDescriptor as ImageTransportDescriptor | undefined)
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
    seed: input.seed,
    files,
    mask,
    modelDescriptor: resolveModelDescriptor(input),
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
      // Carry the persisted descriptor so a restart-resumed poll on a fresh
      // transport instance rebuilds per-task state (DashScope's response family).
      modelDescriptor: resolveModelDescriptor(ctx.input)
    })
  } finally {
    if (cancelRemote) ctx.signal.removeEventListener('abort', cancelRemote)
  }
}

/** Download result URLs (always non-empty — the caller guards) and persist each as an internal FileEntry. */
async function downloadAndPersistImageUrls(urls: string[], signal: AbortSignal): Promise<FileEntry[]> {
  const fileManager = application.get('FileManager')
  const files: FileEntry[] = []
  for (const url of urls) {
    if (signal.aborted) throw createAbortError('Image generation aborted')
    const downloaded = await downloadImageAsBase64(url)
    if (!downloaded) continue
    files.push(
      await fileManager.createInternalEntry({
        source: 'base64',
        data: `data:${downloaded.media_type || 'image/png'};base64,${downloaded.data}`
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
    logger.warn('Some generated image downloads failed', { requested: urls.length, persisted: files.length })
  }
  return files
}

/**
 * Best-effort delete the per-job temp input/mask FileEntries created by
 * `generateImageViaJob`. They carry no FileManager ref, so without this they would
 * leak permanently (the orphan scan only reports, never deletes). Idempotent and
 * non-throwing so it is safe to call from both the handler and the IPC `finally`.
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
