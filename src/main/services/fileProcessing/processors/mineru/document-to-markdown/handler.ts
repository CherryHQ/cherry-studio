import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import {
  assertHasFilePath,
  getRequiredApiHost,
  getRequiredApiKey,
  getRequiredCapability
} from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, FileProcessingRemotePollResult } from '../../types'
import type { MineruExtractFileResult, PreparedMineruQueryContext, PreparedMineruStartContext } from '../types'
import { createUploadTask, getBatchResult, mapProgress, uploadFile } from '../utils'

type MineruQueryContext = Omit<PreparedMineruQueryContext, 'signal'>

export const mineruDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  MineruQueryContext
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
      }
    }
  }
}

function prepareStartContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedMineruStartContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'document_to_markdown', 'mineru')
  assertHasFilePath(file)

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'mineru'),
    file,
    modelVersion: capability.modelId
  }
}

function buildPollResult(
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
