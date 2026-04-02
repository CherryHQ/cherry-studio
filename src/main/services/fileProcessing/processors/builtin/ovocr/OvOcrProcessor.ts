import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import type { FileProcessingTextExtractionResult } from '../../../contracts/types'
import { BaseTextExtractionProcessor } from '../../base/BaseFileProcessor'
import { executeExtraction, prepareContext } from './utils'

export class OvOcrProcessor extends BaseTextExtractionProcessor {
  constructor() {
    super('ovocr')
  }

  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const context = prepareContext(file, config, signal)
    return executeExtraction(context)
  }
}
