import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import type { FileProcessingTextExtractionResult } from '../../types'
import { BaseTextExtractionProcessor } from '../base/BaseFileProcessor'

export class TesseractProcessor extends BaseTextExtractionProcessor {
  constructor() {
    super('tesseract')
  }

  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    void file
    void config
    void signal
    throw new Error('TesseractProcessor.extractText is not implemented')
  }
}
