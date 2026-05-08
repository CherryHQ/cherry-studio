import { Mistral } from '@mistralai/mistralai'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import {
  assertHasFilePath,
  getRequiredApiHost,
  getRequiredApiKey,
  getRequiredCapability
} from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedMistralContext } from '../types'
import { buildTextExtractionResult, executeExtraction, prepareDocumentPayload } from '../utils'

export const mistralImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const context = prepareContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        const executionContextWithSignal = {
          ...context,
          signal: executionContext.signal
        }
        const document = await prepareDocumentPayload(executionContextWithSignal)
        const response = await executeExtraction(executionContextWithSignal, document)
        return buildTextExtractionResult(response)
      }
    }
  }
}

function prepareContext(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal): PreparedMistralContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'image_to_text', 'mistral')
  assertHasFilePath(file)

  return {
    file,
    client: new Mistral({
      apiKey: getRequiredApiKey(config, 'mistral'),
      serverURL: getRequiredApiHost(capability)
    }),
    model: capability.modelId
  }
}
