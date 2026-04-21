import { Mistral } from '@mistralai/mistralai'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import { assertHasFilePath, getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../utils/provider'
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
  assertHasFilePath(file)

  return {
    file,
    signal,
    client: new Mistral({
      apiKey: getRequiredApiKey(config, 'mistral'),
      serverURL: getRequiredApiHost(capability)
    }),
    model: capability.modelId
  }
}
