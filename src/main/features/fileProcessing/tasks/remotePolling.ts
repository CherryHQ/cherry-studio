import { loggerService } from '@logger'
import type { JobContext } from '@main/core/job/types'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileProcessingStage } from '@shared/data/types/fileProcessing'

import type {
  FileProcessingHandlerOutput,
  FileProcessingRemoteContext,
  FileProcessingRemotePollResult,
  PersistableRemoteState,
  PreparedRemoteJob
} from '../processors/types'
import type { FileProcessingJobPayload } from './shared'

const logger = loggerService.withContext('FileProcessing:RemotePolling')
const POLL_INTERVAL_MS = 1_000

export async function executeRemotePolling(
  ctx: JobContext<FileProcessingJobPayload>,
  prepared: PreparedRemoteJob,
  config: FileProcessorMerged
): Promise<FileProcessingHandlerOutput> {
  const startedAt = Date.now()
  let providerTaskId: string | undefined
  let currentStage: FileProcessingStage | null = null
  let lastKnownStage: FileProcessingStage | null = null
  try {
    let remoteContext: FileProcessingRemoteContext

    const persisted = ctx.metadata.remoteState as PersistableRemoteState | undefined
    if (persisted?.providerTaskId) {
      const rehydrated = prepared.rehydrate(persisted, config)
      providerTaskId = rehydrated.providerTaskId
      remoteContext = rehydrated.remoteContext
      logger.debug('Resumed remote-poll job from persisted state', {
        jobId: ctx.jobId,
        providerTaskId,
        stage: null
      })
      ctx.reportProgress(0, { stage: null })
    } else {
      const start = await prepared.startRemote(ctx.signal)
      providerTaskId = start.providerTaskId
      remoteContext = start.remoteContext
      await ctx.patchMetadata({ remoteState: prepared.toPersistable(remoteContext, providerTaskId) })
      ctx.reportProgress(start.progress, { stage: null })
    }

    while (!ctx.signal.aborted) {
      const result: FileProcessingRemotePollResult = await prepared.pollRemote(
        { providerTaskId, remoteContext },
        ctx.signal
      )

      if (result.status === 'failed') {
        const message =
          result.error?.trim() ||
          `${config.id} ${ctx.input.feature} failed (no diagnostic, providerTaskId=${providerTaskId})`
        throw new Error(message)
      }

      if (result.status === 'completed') {
        ctx.signal.throwIfAborted()
        return result.output
      }

      currentStage = result.stage ?? null
      if (currentStage !== null) {
        lastKnownStage = currentStage
      }
      ctx.reportProgress(result.progress, { stage: currentStage })

      if (result.remoteContext !== undefined && result.remoteContext !== remoteContext) {
        remoteContext = result.remoteContext
        await ctx.patchMetadata({ remoteState: prepared.toPersistable(remoteContext, providerTaskId) })
      }

      await sleepWithSignal(POLL_INTERVAL_MS, ctx.signal)
    }

    throw new DOMException('aborted', 'AbortError')
  } catch (error) {
    if (ctx.signal.aborted && prepared.formatPollingAbort) {
      const elapsedMs = Math.max(0, Date.now() - startedAt)
      logger.warn('Remote polling aborted', {
        jobId: ctx.jobId,
        providerTaskId,
        stage: currentStage,
        lastKnownStage,
        elapsedMs
      })
      throw new Error(prepared.formatPollingAbort({ lastKnownStage, elapsedMs }), { cause: error })
    }
    throw error
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
