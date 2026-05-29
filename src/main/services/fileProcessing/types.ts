import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileEntryId } from '@shared/data/types/file'
export type {
  FileProcessingArtifact,
  FileProcessingTaskResult,
  FileProcessingTaskStartResult,
  ListAvailableFileProcessorsResult
} from '@shared/data/types/fileProcessing'

export interface StartFileProcessingTaskInput {
  feature: FileProcessorFeature
  fileEntryId: FileEntryId
  processorId?: FileProcessorId
}
