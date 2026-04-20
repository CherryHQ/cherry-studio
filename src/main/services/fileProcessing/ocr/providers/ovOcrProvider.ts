import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import type { OcrProvider } from '../OcrProvider'
import { executeExtraction, prepareContext } from './ovocr/utils'

export const ovOcrProvider: OcrProvider = {
  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const context = prepareContext(file, config, signal)
    return executeExtraction(context)
  }
}
