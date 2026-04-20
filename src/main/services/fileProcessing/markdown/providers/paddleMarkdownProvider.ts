import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import { getApiKey, getRequiredCapability } from '../../utils/provider'
import type { MarkdownProviderPollResult, MarkdownRemoteTaskProvider } from '../types'
import type { PreparedPaddleQueryContext, PreparedPaddleStartContext } from './paddle/types'
import { createJob, getJobResult, mapProgress, resolveJsonlResult } from './paddle/utils'

type PaddleQueryContext = Omit<PreparedPaddleQueryContext, 'signal'>

export const paddleMarkdownProvider: MarkdownRemoteTaskProvider = {
  mode: 'remote-poll',

  async startTask(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal) {
    const context = prepareStartContext(config, signal, file)
    const job = await createJob(context)

    return {
      providerTaskId: job.jobId,
      status: 'pending',
      progress: 0,
      queryContext: {
        apiHost: context.apiHost,
        apiKey: context.apiKey
      } satisfies PaddleQueryContext
    }
  },

  async pollTask(task, signal): Promise<MarkdownProviderPollResult> {
    const queryContext = task.queryContext as PaddleQueryContext
    const context: PreparedPaddleQueryContext = {
      apiHost: queryContext.apiHost,
      apiKey: queryContext.apiKey,
      signal
    }
    const jobResult = await getJobResult(task.providerTaskId, context)

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

    const markdownContent = await resolveJsonlResult(task.providerTaskId, jobResult, context.signal)

    return {
      status: 'completed',
      result: {
        kind: 'markdown',
        markdownContent
      }
    }
  }
}

function prepareStartContext(
  config: FileProcessorMerged,
  signal: AbortSignal | undefined,
  file: FileMetadata
): PreparedPaddleStartContext {
  const capability = getRequiredCapability(config, 'markdown_conversion', 'paddleocr')

  if (!file.path) {
    throw new Error('File path is required')
  }

  const apiHost = capability.apiHost?.trim().replace(/\/+$/, '')
  if (!apiHost) {
    throw new Error('API host is required')
  }

  const apiKey = getApiKey(config, 'paddleocr')
  if (!apiKey) {
    throw new Error('API key is required')
  }

  const model = capability.modelId?.trim() || undefined

  if (model === 'PP-OCRv5') {
    throw new Error('PaddleOCR model PP-OCRv5 is not supported yet')
  }

  return {
    apiHost,
    apiKey,
    signal,
    file,
    model,
    feature: 'markdown_conversion'
  }
}
