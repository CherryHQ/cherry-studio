import { Mistral } from '@mistralai/mistralai'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedMistralContext } from '../types'
import { buildTextExtractionResult, executeExtraction, prepareDocumentPayload } from '../utils'

export const mistralImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  mode: 'background',
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

function prepareContext(file: FileInfo, config: FileProcessorMerged, signal?: AbortSignal): PreparedMistralContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'image_to_text', 'mistral')

  return {
    file,
    client: new Mistral({
      apiKey: getRequiredApiKey(config, 'mistral'),
      serverURL: getRequiredApiHost(capability)
    }),
    model: capability.modelId
  }
}
