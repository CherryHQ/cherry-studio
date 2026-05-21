import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import { resolveProcessorConfigByFeature } from '../config/resolveProcessorConfig'
import type {
  FileProcessingRemoteContext,
  FileProcessingRemotePollResult,
  PersistableRemoteState,
  PreparedRemoteTask
} from '../processors/types'
import {
  assertModeMatches,
  cleanupFileProcessingResultsDir,
  createArtifacts,
  type FileProcessingJobOutput,
  type FileProcessingJobPayload,
  getCapabilityHandler
} from './shared'

const logger = loggerService.withContext('FileProcessing:RemotePollJobHandler')

const POLL_INTERVAL_MS = 1_000

/**
 * Handles capability handlers whose execution model is "submit → poll":
 * doc2x / mineru / paddleocr document-to-markdown. Persists the minimum state
 * needed to resume polling across a process restart in jobTable.metadata.
 *
 * Whitelist persistence: ONLY publishable identifiers (providerTaskId, stage,
 * apiHost) are written to metadata via `capability.toPersistable(...)`. The
 * apiKey and any other sensitive material is re-read from FileProcessorMerged
 * config (which is sourced from PreferenceService) on every execute() — never
 * persisted to the job row. `rehydrate(persisted, config)` is the entry point
 * back into a typed in-memory remoteContext after restart.
 *
 * Recovery: 'retry'. After restart, JobManager resets running → pending and
 * re-dispatches; this handler sees the prior metadata via ctx.metadata and
 * skips startRemote(), going straight to pollRemote() with the recovered
 * providerTaskId.
 */
export const remotePollJobHandler: JobHandler<FileProcessingJobPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => `file-processing.${input.processorId}`,
  defaultConcurrency: 2,
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const { feature, file, processorId } = ctx.input
    const config = resolveProcessorConfigByFeature(feature, processorId)
    const capability = getCapabilityHandler(config.id, feature)
    assertModeMatches(capability, 'remote-poll')

    const prepared = await capability.prepare(file, config, ctx.signal)
    assertModeMatches(prepared, 'remote-poll')
    const remote = prepared as PreparedRemoteTask<typeof feature, FileProcessingRemoteContext>

    let providerTaskId: string
    let remoteContext: FileProcessingRemoteContext

    const persisted = ctx.metadata.remoteState as PersistableRemoteState | undefined
    if (persisted?.providerTaskId) {
      const rehydrated = remote.rehydrate(persisted, config)
      providerTaskId = rehydrated.providerTaskId
      remoteContext = rehydrated.remoteContext
      logger.debug('Resumed remote-poll job from persisted state', {
        jobId: ctx.jobId,
        providerTaskId,
        stage: persisted.stage
      })
    } else {
      const start = await remote.startRemote(ctx.signal)
      providerTaskId = start.providerTaskId
      remoteContext = start.remoteContext
      await ctx.patchMetadata({ remoteState: remote.toPersistable(remoteContext, providerTaskId) })
      ctx.reportProgress(start.progress, { stage: 'started' })
    }

    let artifactsMayExist = false
    try {
      while (!ctx.signal.aborted) {
        const result: FileProcessingRemotePollResult = await remote.pollRemote(
          { providerTaskId, remoteContext },
          ctx.signal
        )

        if (result.status === 'failed') {
          const message =
            result.error?.trim() || `${config.id} ${feature} failed (no diagnostic, providerTaskId=${providerTaskId})`
          throw new Error(message)
        }

        if (result.status === 'completed') {
          artifactsMayExist = true
          const artifacts = await createArtifacts(ctx.jobId, result.output, ctx.signal)
          return { artifacts } satisfies FileProcessingJobOutput
        }

        ctx.reportProgress(result.progress, { stage: 'polling' })

        if (result.remoteContext !== undefined && result.remoteContext !== remoteContext) {
          remoteContext = result.remoteContext
          await ctx.patchMetadata({ remoteState: remote.toPersistable(remoteContext, providerTaskId) })
        }

        await sleepWithSignal(POLL_INTERVAL_MS, ctx.signal)
      }
      throw new DOMException('aborted', 'AbortError')
    } catch (error) {
      if (artifactsMayExist) {
        const cleaned = await cleanupFileProcessingResultsDir(ctx.jobId)
        logger.warn('Remote-poll execution failed after artifacts may have been created', {
          jobId: ctx.jobId,
          processorId: config.id,
          feature,
          cleaned
        })
      }
      throw error
    }
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
