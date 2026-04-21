import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import { assertHasFilePath, getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../utils/provider'
import type { MarkdownProviderPollResult, MarkdownRemoteTaskProvider } from '../types'
import type { MineruExtractFileResult, PreparedMineruQueryContext, PreparedMineruStartContext } from './mineru/types'
import { createUploadTask, getBatchResult, mapProgress, uploadFile } from './mineru/utils'

type MineruQueryContext = Omit<PreparedMineruQueryContext, 'signal'>

export const mineruMarkdownProvider: MarkdownRemoteTaskProvider = {
  mode: 'remote-poll',

  async startTask(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal) {
    const context = prepareStartContext(config, signal, file)
    const uploadTask = await createUploadTask(context)

    await uploadFile(file, uploadTask.uploadUrl, context.apiHost, uploadTask.uploadHeaders, context.signal)

    return {
      providerTaskId: uploadTask.batchId,
      status: 'processing',
      progress: 0,
      queryContext: {
        apiHost: context.apiHost,
        apiKey: context.apiKey
      } satisfies MineruQueryContext
    }
  },

  async pollTask(task, signal): Promise<MarkdownProviderPollResult> {
    const queryContext = task.queryContext as MineruQueryContext
    const context: PreparedMineruQueryContext = {
      apiHost: queryContext.apiHost,
      apiKey: queryContext.apiKey,
      signal
    }
    const batchResult = await getBatchResult(task.providerTaskId, context)

    return buildPollResult(batchResult.extract_result[0], context.apiHost)
  }
}

function prepareStartContext(
  config: FileProcessorMerged,
  signal: AbortSignal | undefined,
  file: FileMetadata
): PreparedMineruStartContext {
  const capability = getRequiredCapability(config, 'markdown_conversion', 'mineru')
  assertHasFilePath(file)

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'mineru'),
    signal,
    file,
    modelVersion: capability.modelId
  }
}

function buildPollResult(fileResult: MineruExtractFileResult | undefined, apiHost: string): MarkdownProviderPollResult {
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
      progress: mapProgress(fileResult)
    }
  }

  if (!fileResult.full_zip_url) {
    throw new Error('Mineru task completed without full_zip_url')
  }

  return {
    status: 'completed',
    result: {
      kind: 'remote-zip-url',
      downloadUrl: fileResult.full_zip_url,
      configuredApiHost: apiHost
    }
  }
}
