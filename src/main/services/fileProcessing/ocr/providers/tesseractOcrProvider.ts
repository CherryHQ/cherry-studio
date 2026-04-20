import { application } from '@main/core/application'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import type { OcrProvider } from '../OcrProvider'
import { prepareContext } from './tesseract/utils'

export const tesseractOcrProvider: OcrProvider = {
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
