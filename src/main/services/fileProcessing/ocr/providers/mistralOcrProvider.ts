import { Mistral } from '@mistralai/mistralai'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import { getApiKey, getRequiredCapability } from '../../utils/provider'
import type { OcrProvider } from '../OcrProvider'
import type { PreparedMistralContext } from './mistral/types'
import { buildTextExtractionResult, executeExtraction, prepareDocumentPayload } from './mistral/utils'

export const mistralOcrProvider: OcrProvider = {
  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const context = prepareContext(file, config, signal)
    const document = await prepareDocumentPayload(context)
    const response = await executeExtraction(context, document)

    return buildTextExtractionResult(response)
  }
}

function prepareContext(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal): PreparedMistralContext {
  const capability = getRequiredCapability(config, 'text_extraction', 'mistral')

  if (!file.path) {
    throw new Error('File path is required')
  }

  const apiKey = getApiKey(config, 'mistral')
  if (!apiKey) {
    throw new Error('API key is required')
  }

  const apiHost = capability.apiHost?.trim()
  if (!apiHost) {
    throw new Error('API host is required')
  }

  return {
    file,
    signal,
    client: new Mistral({
      apiKey,
      serverURL: apiHost
    }),
    model: capability.modelId
  }
}
