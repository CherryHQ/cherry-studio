import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileInfo } from '@shared/file/types'

import { paddleOcrSdkService } from '@main/services/paddleocr/PaddleOcrSdkService'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import type { PaddleRemoteContext, PreparedPaddleStartContext } from '../types'

type PaddleDocumentRemoteContext = PaddleRemoteContext

export const paddleDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  PaddleDocumentRemoteContext
> = {
  mode: 'remote-poll',
  prepare(file, config, signal, context) {
    signal?.throwIfAborted()
    const startContext = prepareStartContext(file, config, context?.fileEntryId, signal)

    return {
      mode: 'remote-poll',
      async startRemote(startSignal) {
        const task = await paddleOcrSdkService.startDocumentParsing({
          taskId: startContext.taskId,
          token: startContext.apiKey,
          baseUrl: startContext.apiHost,
          filePath: startContext.file.path,
          model: startContext.model,
          signal: startSignal
        })

        return {
          providerTaskId: task.providerTaskId,
          status: task.status,
          progress: 0,
          remoteContext: {
            apiHost: startContext.apiHost,
            apiKey: startContext.apiKey
          }
        }
      },
      async pollRemote(task, pollSignal) {
        const status = await paddleOcrSdkService.getDocumentParsingStatus({
          taskId: startContext.taskId,
          providerTaskId: task.providerTaskId,
          token: task.remoteContext.apiKey,
          baseUrl: task.remoteContext.apiHost,
          signal: pollSignal
        })

        if (status.status === 'failed') {
          return {
            status: 'failed',
            error: `PaddleOCR markdown conversion failed (providerTaskId=${task.providerTaskId})`
          }
        }

        if (status.status !== 'completed') {
          return {
            status: status.status,
            progress: status.progress
          }
        }

        const result = await paddleOcrSdkService.getDocumentParsingResult({
          taskId: startContext.taskId,
          providerTaskId: task.providerTaskId,
          token: task.remoteContext.apiKey,
          baseUrl: task.remoteContext.apiHost,
          signal: pollSignal
        })

        return {
          status: 'completed',
          output: {
            kind: 'markdown',
            markdownContent: result.result.markdown
          }
        }
      },
      toPersistable(remoteContext, providerTaskId) {
        return {
          providerTaskId,
          apiHost: remoteContext.apiHost
        }
      },
      rehydrate(persisted, restoredConfig) {
        if (!persisted.apiHost) {
          throw new Error('paddleocr rehydrate: missing apiHost in persisted remote state')
        }
        return {
          providerTaskId: persisted.providerTaskId,
          remoteContext: {
            apiHost: persisted.apiHost,
            apiKey: getRequiredApiKey(restoredConfig, 'paddleocr')
          }
        }
      }
    }
  }
}

function prepareStartContext(
  file: FileInfo,
  config: FileProcessorMerged,
  taskId = file.path,
  signal?: AbortSignal
): PreparedPaddleStartContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'document_to_markdown', 'paddleocr')

  const model = capability.modelId?.trim() || undefined

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'paddleocr'),
    file,
    model,
    taskId
  }
}

export async function buildPollResult(
  providerTaskId: string,
  remoteContext: PaddleDocumentRemoteContext,
  taskId = providerTaskId,
  signal?: AbortSignal
): Promise<FileProcessingRemotePollResult<'document_to_markdown', PaddleDocumentRemoteContext>> {
  const status = await paddleOcrSdkService.getDocumentParsingStatus({
    taskId,
    providerTaskId,
    token: remoteContext.apiKey,
    baseUrl: remoteContext.apiHost,
    signal
  })

  if (status.status === 'failed') {
    return {
      status: 'failed',
      error: `PaddleOCR markdown conversion failed (providerTaskId=${providerTaskId})`
    }
  }

  if (status.status !== 'completed') {
    return {
      status: status.status,
      progress: status.progress
    }
  }

  const result = await paddleOcrSdkService.getDocumentParsingResult({
    taskId,
    providerTaskId,
    token: remoteContext.apiKey,
    baseUrl: remoteContext.apiHost,
    signal
  })

  return {
    status: 'completed',
    output: {
      kind: 'markdown',
      markdownContent: result.result.markdown
    }
  }
}
