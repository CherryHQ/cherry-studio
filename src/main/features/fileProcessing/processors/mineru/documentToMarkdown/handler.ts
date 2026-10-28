import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileProcessingStage } from '@shared/data/types/fileProcessing'
import type { FileInfo } from '@shared/types/file'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import type { MineruExtractFileResult, PreparedMineruQueryContext, PreparedMineruStartContext } from '../types'
import { createUploadTask, getBatchResult, mapProgress, uploadFile } from '../utils'

const MINERU_STAGES: Record<Exclude<MineruExtractFileResult['state'], 'done' | 'failed'>, FileProcessingStage> = {
  'waiting-file': 'uploading',
  pending: 'queued',
  running: 'parsing',
  converting: 'converting'
}

const MINERU_REMOTE_STATES: Record<FileProcessingStage, MineruExtractFileResult['state']> = {
  uploading: 'waiting-file',
  queued: 'pending',
  parsing: 'running',
  converting: 'converting'
}

export function formatMineruPollingAbort(details: {
  lastKnownStage: FileProcessingStage | null
  elapsedMs: number
}): string {
  const state = details.lastKnownStage === null ? 'unknown' : MINERU_REMOTE_STATES[details.lastKnownStage]
  return `MinerU polling aborted; last known remote state=${state}; elapsed polling wait this attempt=${Math.max(0, Math.floor(details.elapsedMs))} ms`
}

type MineruQueryContext = Omit<PreparedMineruQueryContext, 'signal'>

export const mineruDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  MineruQueryContext
> = {
  mode: 'remote-poll',
  prepare(file, config, signal, context) {
    signal?.throwIfAborted()
    const startContext = prepareStartContext(file, config, context?.dataId, signal)

    return {
      mode: 'remote-poll',
      formatPollingAbort: formatMineruPollingAbort,
      async startRemote(startSignal) {
        const uploadTask = await createUploadTask({
          ...startContext,
          signal: startSignal
        })

        await uploadFile(
          startContext.file,
          uploadTask.uploadUrl,
          startContext.apiHost,
          uploadTask.uploadHeaders,
          startSignal
        )

        return {
          providerTaskId: uploadTask.batchId,
          status: 'processing',
          progress: 0,
          remoteContext: {
            apiHost: startContext.apiHost,
            apiKey: startContext.apiKey
          }
        }
      },
      async pollRemote(
        task,
        pollSignal
      ): Promise<FileProcessingRemotePollResult<'document_to_markdown', MineruQueryContext>> {
        const context: PreparedMineruQueryContext = {
          apiHost: task.remoteContext.apiHost,
          apiKey: task.remoteContext.apiKey,
          signal: pollSignal
        }
        const batchResult = await getBatchResult(task.providerTaskId, context)

        return buildPollResult(batchResult.extract_result[0], context.apiHost)
      },
      toPersistable(remoteContext, providerTaskId) {
        return {
          providerTaskId,
          apiHost: remoteContext.apiHost
        }
      },
      rehydrate(persisted, restoredConfig) {
        if (!persisted.apiHost) {
          throw new Error('mineru rehydrate: missing apiHost in persisted remote state')
        }
        return {
          providerTaskId: persisted.providerTaskId,
          remoteContext: {
            apiHost: persisted.apiHost,
            apiKey: getRequiredApiKey(restoredConfig, 'mineru')
          }
        }
      }
    }
  }
}

function prepareStartContext(
  file: FileInfo,
  config: FileProcessorMerged,
  dataId: string | undefined,
  signal?: AbortSignal
): PreparedMineruStartContext {
  signal?.throwIfAborted()
  if (!dataId) {
    throw new Error('mineru prepare: missing dataId')
  }

  const capability = getRequiredCapability(config, 'document_to_markdown', 'mineru')

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'mineru'),
    dataId,
    file,
    modelVersion: capability.modelId
  }
}

export function buildPollResult(
  fileResult: MineruExtractFileResult | undefined,
  apiHost: string
): FileProcessingRemotePollResult<'document_to_markdown', MineruQueryContext> {
  if (!fileResult) {
    return {
      status: 'processing',
      progress: 0
    }
  }

  if (fileResult.state === 'failed') {
    return {
      status: 'failed',
      error: fileResult.err_msg || 'Mineru markdown conversion failed'
    }
  }

  if (fileResult.state !== 'done') {
    return {
      status: 'processing',
      stage: MINERU_STAGES[fileResult.state],
      progress: mapProgress(fileResult)
    }
  }

  if (!fileResult.full_zip_url) {
    throw new Error('Mineru task completed without full_zip_url')
  }

  return {
    status: 'completed',
    output: {
      kind: 'remote-zip-url',
      downloadUrl: fileResult.full_zip_url,
      configuredApiHost: apiHost
    }
  }
}
