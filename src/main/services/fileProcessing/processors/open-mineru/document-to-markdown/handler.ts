import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import { assertHasFilePath, getApiKey, getRequiredApiHost, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedOpenMineruContext } from '../types'
import { executeTask } from '../utils'

export const openMineruDocumentToMarkdownHandler: FileProcessingCapabilityHandler<'document_to_markdown'> = {
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const preparedContext: PreparedOpenMineruContext = prepareContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        executionContext.reportProgress(10)
        const response = await executeTask({
          ...preparedContext,
          signal: executionContext.signal
        })
        executionContext.reportProgress(80)

        return {
          kind: 'response-zip',
          response
        }
      }
    }
  }
}

function prepareContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedOpenMineruContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'document_to_markdown', 'open-mineru')
  assertHasFilePath(file)

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getApiKey(config, 'open-mineru'),
    file
  }
}
