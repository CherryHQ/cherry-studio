import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { getApiKey, getRequiredCapability } from '../../utils/provider'
import type { MarkdownBackgroundExecutionContext, MarkdownBackgroundTaskProvider } from '../types'
import type { PreparedOpenMineruContext } from './open-mineru/types'
import { executeTask } from './open-mineru/utils'

export const openMineruMarkdownProvider: MarkdownBackgroundTaskProvider = {
  mode: 'background',

  async startTask(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal) {
    prepareContext(file, config, signal)

    return {
      providerTaskId: uuidv4(),
      status: 'processing',
      progress: 0
    }
  },

  async executeTask(file: FileMetadata, config: FileProcessorMerged, context: MarkdownBackgroundExecutionContext) {
    const preparedContext = prepareContext(file, config, context.signal)

    context.reportProgress(10)
    const response = await executeTask(preparedContext)
    context.reportProgress(80)

    return {
      kind: 'response-zip',
      response
    } as const
  }
}

function prepareContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedOpenMineruContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'markdown_conversion', 'open-mineru')

  if (!file.path) {
    throw new Error('File path is required')
  }

  const apiHost = capability.apiHost?.trim()
  if (!apiHost) {
    throw new Error('API host is required')
  }

  return {
    apiHost,
    apiKey: getApiKey(config, 'open-mineru'),
    file,
    signal
  }
}
