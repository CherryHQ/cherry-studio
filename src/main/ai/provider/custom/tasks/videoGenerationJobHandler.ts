import { application } from '@application'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { URLString } from '@shared/file/types/common'

import { providerToAiSdkConfig } from '../../config'
import { createAbortError } from '../transportUtils'
import type { VideoArtifact, VideoGenerationSubmitInput, VideoGenerationTransport } from '../videoGenerationModel'
import { resolveVideoTransport } from '../videoTransportRegistry'
import type { VideoGenerationJobOutput, VideoGenerationJobPayload } from './jobTypes'

const logger = loggerService.withContext('VideoGenerationJobHandler')

/**
 * Async video-generation handler for aggregator submit/poll transports (DMXAPI /
 * PPIO / AiHubMix). The video counterpart of `imageGenerationJobHandler`: it owns
 * the poll loop so it survives a restart (the remote `taskId` is persisted to job
 * metadata after submit; recovery re-dispatches and resumes polling the same task
 * instead of re-submitting and burning vendor quota).
 *
 * Secrets are never persisted — the apiKey is re-read from provider config on every
 * attempt via `providerToAiSdkConfig`. Media inputs are referenced by FileEntry id
 * and read back from FileManager. Result videos are downloaded straight to disk
 * (`source: 'url'`) rather than base64-in-memory (they can be hundreds of MB).
 */
export const videoGenerationJobHandler: JobHandler<VideoGenerationJobPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => `video-generation.${parseUniqueModelId(input.uniqueModelId).providerId}`,
  defaultConcurrency: 2,
  // The transport retries transient poll errors internally; a job-level retry would
  // re-submit and burn the user's vendor quota, so cap at 1 attempt (parity with image).
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  // Video generation is slow — Veo/Seedance/Kling routinely run several minutes.
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const input = ctx.input
    try {
      const { providerId, modelId } = parseUniqueModelId(input.uniqueModelId)
      const provider = await providerService.getByProviderId(providerId)
      if (!provider) throw new Error(`Video generation job: provider '${providerId}' not found`)
      const model = await modelService.getByKey(providerId, modelId)
      if (!model) throw new Error(`Video generation job: model '${modelId}' not found for provider '${providerId}'`)

      const sdkConfig = { ...(await providerToAiSdkConfig(provider, model)), modelId: model.apiModelId ?? model.id }
      const transport = resolveVideoTransport(sdkConfig.providerId, sdkConfig.modelId, sdkConfig.providerSettings)
      if (!transport) {
        throw new Error(
          `Video generation job: no async transport for '${sdkConfig.providerId}' (model '${sdkConfig.modelId}')`
        )
      }

      let artifacts: VideoArtifact[]
      const persistedTaskId = typeof ctx.metadata.taskId === 'string' ? ctx.metadata.taskId : undefined
      if (persistedTaskId) {
        logger.debug('Resuming video-generation job from persisted task', { jobId: ctx.jobId, taskId: persistedTaskId })
        artifacts = await pollUntilDone(transport, persistedTaskId, ctx)
      } else {
        const submit = await transport.submit(await buildSubmitInput(input, sdkConfig.modelId, ctx.signal))
        if (submit.videos) {
          artifacts = submit.videos
        } else if (submit.taskId) {
          // CRITICAL: persist before polling — without this, restart-recovery re-submits.
          await ctx.patchMetadata({ taskId: submit.taskId })
          artifacts = await pollUntilDone(transport, submit.taskId, ctx)
        } else {
          throw new Error(`Video generation submit for '${sdkConfig.modelId}' returned neither videos nor a taskId`)
        }
      }

      if (artifacts.length === 0) {
        throw new Error(`Video generation for '${sdkConfig.modelId}' completed but returned no videos`)
      }

      const files = await persistVideoArtifacts(artifacts, ctx.signal)
      ctx.reportProgress(100, { stage: 'done' })
      return { files } satisfies VideoGenerationJobOutput
    } finally {
      // Best-effort cleanup of the per-job temp media copies (owned by the handler so
      // it covers restart-resume too). Resume polls the persisted taskId and never
      // re-reads these ids.
      await deleteVideoInputEntries([
        input.firstFrameFileId,
        input.lastFrameFileId,
        input.inputVideoFileId,
        input.inputAudioFileId,
        ...(input.referenceImageFileIds ?? [])
      ])
    }
  }
}

async function buildSubmitInput(
  input: VideoGenerationJobPayload,
  modelId: string,
  signal: AbortSignal
): Promise<VideoGenerationSubmitInput> {
  const [firstFrame, lastFrame, inputVideo, inputAudio, referenceImages] = await Promise.all([
    input.firstFrameFileId ? readMediaAsDataUrl(input.firstFrameFileId) : undefined,
    input.lastFrameFileId ? readMediaAsDataUrl(input.lastFrameFileId) : undefined,
    input.inputVideoFileId ? readMediaAsDataUrl(input.inputVideoFileId) : undefined,
    input.inputAudioFileId ? readMediaAsDataUrl(input.inputAudioFileId) : undefined,
    input.referenceImageFileIds?.length ? Promise.all(input.referenceImageFileIds.map(readMediaAsDataUrl)) : undefined
  ])
  return {
    modelId,
    prompt: input.prompt,
    firstFrame,
    lastFrame,
    inputVideo,
    inputAudio,
    referenceImages,
    providerParams: input.providerParams,
    signal
  }
}

/** Read a stored media FileEntry as a `data:` URL (vendors accept base64 data-URIs for image inputs). */
async function readMediaAsDataUrl(fileId: string): Promise<string> {
  const { content, mime } = await application.get('FileManager').read(fileId, { encoding: 'base64' })
  return `data:${mime};base64,${content}`
}

/** Run the transport poll loop, cancelling the remote task on job abort (mirrors the image handler). */
async function pollUntilDone(
  transport: VideoGenerationTransport,
  taskId: string,
  ctx: JobContext<VideoGenerationJobPayload>
): Promise<VideoArtifact[]> {
  if (!transport.poll) {
    throw new Error('Video transport returned a task id but does not implement polling')
  }
  const cancelRemote = transport.cancel ? () => void transport.cancel?.(taskId).catch(() => {}) : undefined
  if (cancelRemote) {
    if (ctx.signal.aborted) {
      cancelRemote()
      throw createAbortError('Video generation aborted')
    }
    ctx.signal.addEventListener('abort', cancelRemote, { once: true })
  }
  try {
    return await transport.poll(taskId, {
      signal: ctx.signal,
      onProgress: (progress) => ctx.reportProgress(progress, { stage: 'polling' }),
      providerParams: ctx.input.providerParams
    })
  } finally {
    if (cancelRemote) ctx.signal.removeEventListener('abort', cancelRemote)
  }
}

/**
 * Persist each produced video. URL artifacts stream to disk (`source: 'url'`, no
 * base64-in-memory); byte artifacts (authenticated vendors like AiHubMix) are written
 * from the bytes the transport already fetched.
 */
async function persistVideoArtifacts(artifacts: VideoArtifact[], signal: AbortSignal): Promise<FileEntry[]> {
  const fileManager = application.get('FileManager')
  const files: FileEntry[] = []
  for (const artifact of artifacts) {
    if (signal.aborted) throw createAbortError('Video generation aborted')
    try {
      if ('url' in artifact) {
        files.push(await fileManager.createInternalEntry({ source: 'url', url: artifact.url as URLString }))
      } else {
        const ext = (artifact.mediaType?.split('/')[1] || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4'
        files.push(await fileManager.createInternalEntry({ source: 'bytes', data: artifact.bytes, name: 'video', ext }))
      }
    } catch (error) {
      logger.warn('Failed to persist generated video', { error })
    }
  }
  if (files.length === 0) {
    throw new Error(`Video generation produced ${artifacts.length} artifact(s) but all failed to persist`)
  }
  if (files.length < artifacts.length) {
    logger.warn('Some generated videos failed to persist', { produced: artifacts.length, persisted: files.length })
  }
  return files
}

/** Best-effort delete the per-job temp media FileEntries. Idempotent and non-throwing. */
export async function deleteVideoInputEntries(ids: ReadonlyArray<string | undefined>): Promise<void> {
  const present = ids.filter((id): id is string => Boolean(id))
  if (present.length === 0) return
  const fileManager = application.get('FileManager')
  await Promise.all(
    present.map((id) =>
      fileManager.permanentDelete(id).catch((error) => logger.warn('Failed to delete video input entry', { id, error }))
    )
  )
}
