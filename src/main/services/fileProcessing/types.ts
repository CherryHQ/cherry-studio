import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
export type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

export interface BaseProcessFileInput {
  file: FileMetadata
  processorId?: FileProcessorId
  signal?: AbortSignal
}

export interface ExtractTextInput extends BaseProcessFileInput {}

export interface StartMarkdownConversionTaskInput extends BaseProcessFileInput {}

export interface GetMarkdownConversionTaskResultInput {
  taskId: string
  signal?: AbortSignal
}
