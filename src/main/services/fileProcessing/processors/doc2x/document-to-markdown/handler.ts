import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import {
  assertHasFilePath,
  getRequiredApiHost,
  getRequiredApiKey,
  getRequiredCapability
} from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import type { Doc2xTaskStage, PreparedDoc2xQueryContext, PreparedDoc2xStartContext } from '../types'
import { createUploadTask, getExportResult, getParseStatus, triggerExportTask, uploadFile } from '../utils'

type Doc2xQueryContext = Omit<PreparedDoc2xQueryContext, 'signal'> & {
  stage: Doc2xTaskStage
}

export const doc2xDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  Doc2xQueryContext
> = {
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const startContext = prepareStartContext(file, config, signal)

    return {
      mode: 'remote-poll',
      async startRemote(startSignal) {
        const uploadTask = await createUploadTask({
          ...startContext,
          signal: startSignal
        })

        await uploadFile(startContext.file.path, uploadTask.uploadUrl, startContext.apiHost, startSignal)

        return {
          providerTaskId: uploadTask.uid,
          status: 'processing',
          progress: 0,
          remoteContext: {
            apiHost: startContext.apiHost,
            apiKey: startContext.apiKey,
            stage: 'parsing'
          }
        }
      },
      async pollRemote(
        task,
        pollSignal
      ): Promise<FileProcessingRemotePollResult<'document_to_markdown', Doc2xQueryContext>> {
        const context: PreparedDoc2xQueryContext = {
          apiHost: task.remoteContext.apiHost,
          apiKey: task.remoteContext.apiKey,
          signal: pollSignal
        }

        if (task.remoteContext.stage === 'parsing') {
          return handleParseStage(task.providerTaskId, task.remoteContext, context)
        }

        return handleExportStage(task.providerTaskId, context)
      }
    }
  }
}

function prepareStartContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedDoc2xStartContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'document_to_markdown', 'doc2x')
  assertHasFilePath(file)

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'doc2x'),
    file,
    modelVersion: capability.modelId
  }
}

async function handleParseStage(
  providerTaskId: string,
  queryContext: Doc2xQueryContext,
  context: PreparedDoc2xQueryContext
): Promise<FileProcessingRemotePollResult<'document_to_markdown', Doc2xQueryContext>> {
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
    remoteContext: {
      ...queryContext,
      stage: 'exporting'
    }
  }
}

async function handleExportStage(
  providerTaskId: string,
  context: PreparedDoc2xQueryContext
): Promise<FileProcessingRemotePollResult<'document_to_markdown', Doc2xQueryContext>> {
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

  if (exportStatus.status !== 'success' || !exportStatus.url) {
    return {
      status: 'processing',
      progress: 99
    }
  }

  return {
    status: 'completed',
    output: {
      kind: 'remote-zip-url',
      downloadUrl: exportStatus.url,
      configuredApiHost: context.apiHost
    }
  }
}
