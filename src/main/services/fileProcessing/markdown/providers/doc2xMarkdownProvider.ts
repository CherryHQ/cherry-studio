import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import { getApiKey, getRequiredCapability } from '../../utils/provider'
import type { MarkdownProviderPollResult, MarkdownRemoteTaskProvider } from '../types'
import type { Doc2xTaskStage, PreparedDoc2xQueryContext, PreparedDoc2xStartContext } from './doc2x/types'
import { createUploadTask, getExportResult, getParseStatus, triggerExportTask, uploadFile } from './doc2x/utils'

type Doc2xQueryContext = Omit<PreparedDoc2xQueryContext, 'signal'> & {
  stage: Doc2xTaskStage
}

export const doc2xMarkdownProvider: MarkdownRemoteTaskProvider = {
  mode: 'remote-poll',

  async startTask(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal) {
    const context = prepareStartContext(config, signal, file)
    const uploadTask = await createUploadTask(context)

    await uploadFile(file.path, uploadTask.uploadUrl, context.signal)

    return {
      providerTaskId: uploadTask.uid,
      status: 'processing',
      progress: 0,
      queryContext: {
        apiHost: context.apiHost,
        apiKey: context.apiKey,
        stage: 'parsing'
      } satisfies Doc2xQueryContext
    }
  },

  async pollTask(task, signal): Promise<MarkdownProviderPollResult> {
    const queryContext = task.queryContext as Doc2xQueryContext
    const context: PreparedDoc2xQueryContext = {
      apiHost: queryContext.apiHost,
      apiKey: queryContext.apiKey,
      signal
    }

    if (queryContext.stage === 'parsing') {
      return handleParseStage(task.providerTaskId, queryContext, context)
    }

    return handleExportStage(task.providerTaskId, context)
  }
}

function prepareStartContext(
  config: FileProcessorMerged,
  signal: AbortSignal | undefined,
  file: FileMetadata
): PreparedDoc2xStartContext {
  const capability = getRequiredCapability(config, 'markdown_conversion', 'doc2x')

  if (!file.path) {
    throw new Error('File path is required')
  }

  const apiHost = capability.apiHost?.trim()
  if (!apiHost) {
    throw new Error('API host is required')
  }

  const apiKey = getApiKey(config, 'doc2x')
  if (!apiKey) {
    throw new Error('API key is required')
  }

  return {
    apiHost,
    apiKey,
    signal,
    file,
    modelVersion: capability.modelId
  }
}

async function handleParseStage(
  providerTaskId: string,
  queryContext: Doc2xQueryContext,
  context: PreparedDoc2xQueryContext
): Promise<MarkdownProviderPollResult> {
  const payload = await getParseStatus(providerTaskId, context)

  if (payload.code !== 'success') {
    return {
      status: 'failed',
      error: payload.msg || payload.message || payload.code
    }
  }

  const parseStatus = payload.data

  if (!parseStatus) {
    throw new Error(`Doc2x parse status response is missing data for uid ${providerTaskId}`)
  }

  if (parseStatus.status === 'failed') {
    return {
      status: 'failed',
      error: parseStatus.detail || 'Doc2x markdown conversion failed'
    }
  }

  if (parseStatus.status !== 'success') {
    return {
      status: 'processing',
      progress: Math.min(98, parseStatus.progress ?? 0)
    }
  }

  const exportPayload = await triggerExportTask(providerTaskId, context)

  if (exportPayload.code !== 'success') {
    return {
      status: 'failed',
      error: exportPayload.msg || exportPayload.message || exportPayload.code
    }
  }

  const exportStatus = exportPayload.data

  if (exportStatus?.status === 'failed') {
    return {
      status: 'failed',
      error: 'Doc2x markdown export failed'
    }
  }

  return {
    status: 'processing',
    progress: 99,
    queryContext: {
      ...queryContext,
      stage: 'exporting'
    } satisfies Doc2xQueryContext
  }
}

async function handleExportStage(
  providerTaskId: string,
  context: PreparedDoc2xQueryContext
): Promise<MarkdownProviderPollResult> {
  const payload = await getExportResult(providerTaskId, context)

  if (payload.code !== 'success') {
    return {
      status: 'failed',
      error: payload.msg || payload.message || payload.code
    }
  }

  const exportStatus = payload.data

  if (!exportStatus) {
    throw new Error(`Doc2x export result response is missing data for uid ${providerTaskId}`)
  }

  if (exportStatus.status === 'failed') {
    return {
      status: 'failed',
      error: 'Doc2x markdown export failed'
    }
  }

  if (exportStatus.status !== 'success') {
    return {
      status: 'processing',
      progress: 99
    }
  }

  if (!exportStatus.url) {
    throw new Error(`Doc2x export result completed without a download URL for uid ${providerTaskId}`)
  }

  return {
    status: 'completed',
    result: {
      kind: 'remote-zip-url',
      downloadUrl: exportStatus.url.replace(/\\u0026/g, '&')
    }
  }
}
