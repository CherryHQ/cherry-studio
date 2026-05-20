import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
export type {
  FileProcessingArtifact,
  FileProcessingTaskResult,
  FileProcessingTaskStartResult,
  ListAvailableFileProcessorsResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

export interface StartFileProcessingTaskInput {
  feature: FileProcessorFeature
  file: FileMetadata
  processorId?: FileProcessorId
}
