import { Mistral } from '@mistralai/mistralai'
import type { FileProcessorFeature } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import { BaseTextExtractionProcessor } from '../../base/BaseFileProcessor'
import type { PreparedMistralContext } from './types'
import { buildTextExtractionResult, executeExtraction, prepareDocumentPayload } from './utils'

export class MistralProcessor extends BaseTextExtractionProcessor {
  constructor() {
    super('mistral')
  }

  async extractText(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal) {
    const context = this.prepareContext(file, config, 'text_extraction', signal)
    const document = await prepareDocumentPayload(context)
    const response = await executeExtraction(context, document)

    return buildTextExtractionResult(response)
  }

  private prepareContext(
    file: FileMetadata,
    config: FileProcessorMerged,
    feature: FileProcessorFeature,
    signal?: AbortSignal
  ): PreparedMistralContext {
    const capability = this.getRequiredCapability(config, feature)

    if (!file.path) {
      throw new Error('File path is required')
    }

    return {
      file,
      signal,
      client: new Mistral({
        apiKey: this.getRequiredApiKey(config),
        serverURL: this.getRequiredApiHost(capability.apiHost)
      }),
      model: this.getRequiredModelId(capability, feature)
    }
  }
}

export const mistralProcessor = new MistralProcessor()
