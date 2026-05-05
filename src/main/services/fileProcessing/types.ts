import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
export type {
  FileProcessingArtifact,
  FileProcessingTaskResult,
  FileProcessingTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

export interface StartFileProcessingTaskInput {
  feature: FileProcessorFeature
  file: FileMetadata
  processorId?: FileProcessorId
  signal?: AbortSignal
}

export interface GetFileProcessingTaskInput {
  taskId: string
  signal?: AbortSignal
}

export interface CancelFileProcessingTaskInput {
  taskId: string
}
