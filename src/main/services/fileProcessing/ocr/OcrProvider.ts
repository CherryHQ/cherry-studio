import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

export interface OcrProvider {
  extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult>
}
