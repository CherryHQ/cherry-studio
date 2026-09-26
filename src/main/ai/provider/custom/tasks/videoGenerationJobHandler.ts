import { eq } from 'drizzle-orm'

import { application } from '@application'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'
import { videoTable } from '@main/data/db/schemas/video'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { parseUniqueModelId } from '@shared/data/types/model'

import type { VideoGenerationJobInput, VideoGenerationJobOutput } from '../videoGenerationModel'
import { resolveVideoTransport } from '../videoTransports/videoTransportRegistry'

const logger = loggerService.withContext('VideoGenerationJobHandler')

const POLL_INTERVAL_MS = 5_000

/**
 * Restart-resilient handler for video generation.
 * Persists the providerTaskId before polling so a restarted job can skip
 * re-submit and resume polling directly.
 */
export const videoGenerationJobHandler: JobHandler<VideoGenerationJobInput> = {
  recovery: 'retry',
  defaultQueue: (input) => `video-generation.${parseUniqueModelId(input.uniqueModelId).providerId}`,
  defaultConcurrency: 1,
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const input = ctx.input
    const { providerId, modelId } = parseUniqueModelId(input.uniqueModelId)

    const provider = providerService.getByProviderId(providerId)
    if (!provider) throw new Error(`Video generation job: provider '${providerId}' not found`)
    const model = modelService.getByKey(providerId, modelId)
    if (!model) throw new Error(`Video generation job: model '${modelId}' not found`)

    const { value: apiKey } = providerService.resolveApiKey(providerId)

    const transport = resolveVideoTransport(providerId, apiKey)
    if (!transport) {
      throw new Error(`Video generation job: no transport for provider '${providerId}'`)
    }

    let providerTaskId: string

    const persisted = ctx.metadata.providerTaskId as string | undefined
    if (persisted) {
      providerTaskId = persisted
      logger.debug('Resumed video job from persisted state', { jobId: ctx.jobId, providerTaskId })
    } else {
      providerTaskId = await transport.submit({
        modelId,
        prompt: input.prompt,
        duration: input.duration,
        resolution: input.resolution
      })
      await ctx.patchMetadata({ providerTaskId })
      application
        .get('DbService')
        .getDb()
        .update(videoTable)
        .set({ providerTaskId, status: 'processing', jobId: ctx.jobId })
        .where(eq(videoTable.id, input.videoId))
        .run()
      ctx.reportProgress(5, { stage: 'submitted' })
    }

    while (!ctx.signal.aborted) {
      let videoUrl: string | null
      try {
        videoUrl = await transport.poll(providerTaskId, ctx.signal)
      } catch (err) {
        application
          .get('DbService')
          .getDb()
          .update(videoTable)
          .set({ status: 'failed', errorMessage: String(err) })
          .where(eq(videoTable.id, input.videoId))
          .run()
        throw err
      }

      if (videoUrl !== null) {
        application
          .get('DbService')
          .getDb()
          .update(videoTable)
          .set({ status: 'completed', videoUrl })
          .where(eq(videoTable.id, input.videoId))
          .run()
        ctx.reportProgress(100, { stage: 'done' })
        return { videoUrl } satisfies VideoGenerationJobOutput
      }

      ctx.reportProgress(50, { stage: 'polling' })
      await sleepWithSignal(POLL_INTERVAL_MS, ctx.signal)
    }

    throw new DOMException('aborted', 'AbortError')
  }
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
