import { application } from '@main/core/application'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import type { FileProcessingTextExtractionResult } from '../../../contracts/types'
import { BaseTextExtractionProcessor } from '../../base/BaseFileProcessor'
import { prepareContext } from './utils'

export class TesseractProcessor extends BaseTextExtractionProcessor {
  constructor() {
    super('tesseract')
  }

  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const context = prepareContext(file, config, signal)
    const tesseractRuntimeService = application.get('TesseractRuntimeService')
    return tesseractRuntimeService.extract(context)
  }
}
