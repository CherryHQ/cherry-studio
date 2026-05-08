import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import {
  assertHasFilePath,
  getRequiredApiHost,
  getRequiredApiKey,
  getRequiredCapability
} from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import type { PaddleJobResultData, PreparedPaddleQueryContext, PreparedPaddleStartContext } from '../types'
import { createJob, getJobResult, mapProgress, resolveJsonlResult } from '../utils'

type PaddleQueryContext = Omit<PreparedPaddleQueryContext, 'signal'>

export const paddleDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  PaddleQueryContext
> = {
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const startContext = prepareStartContext(file, config, signal)

    return {
      mode: 'remote-poll',
      async startRemote(startSignal) {
        const job = await createJob({
          ...startContext,
          signal: startSignal
        })

        return {
          providerTaskId: job.jobId,
          status: 'pending',
          progress: 0,
          remoteContext: {
            apiHost: startContext.apiHost,
            apiKey: startContext.apiKey
          }
        }
      },
      async pollRemote(task, pollSignal) {
        const context: PreparedPaddleQueryContext = {
          apiHost: task.remoteContext.apiHost,
          apiKey: task.remoteContext.apiKey,
          signal: pollSignal
        }
        const jobResult = await getJobResult(task.providerTaskId, context)

        return buildPollResult(task.providerTaskId, jobResult, context.apiHost, context.signal)
      }
    }
  }
}

function prepareStartContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedPaddleStartContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'document_to_markdown', 'paddleocr')
  assertHasFilePath(file)

  const model = capability.modelId?.trim() || undefined

  if (model === 'PP-OCRv5') {
    throw new Error('PaddleOCR model PP-OCRv5 is not supported yet')
  }

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'paddleocr'),
    file,
    model,
    feature: 'document_to_markdown'
  }
}

export async function buildPollResult(
  providerTaskId: string,
  jobResult: PaddleJobResultData,
  apiHost: string,
  signal?: AbortSignal
): Promise<FileProcessingRemotePollResult<'document_to_markdown', PaddleQueryContext>> {
  if (jobResult.state === 'failed') {
    return {
      status: 'failed',
      error: jobResult.errorMsg || 'PaddleOCR markdown conversion failed'
    }
  }

  if (jobResult.state !== 'done') {
    return {
      status: jobResult.state === 'pending' ? 'pending' : 'processing',
      progress: mapProgress(jobResult)
    }
  }

  return {
    status: 'completed',
    output: {
      kind: 'markdown',
      markdownContent: await resolveJsonlResult(providerTaskId, jobResult, apiHost, signal)
    }
  }
}
