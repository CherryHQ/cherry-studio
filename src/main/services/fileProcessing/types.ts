import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
export type {
  FileProcessingArtifact,
  FileProcessingTaskResult,
  FileProcessingTaskStartResult,
  ListAvailableFileProcessorsResult
} from '@shared/data/types/fileProcessing'

export interface StartFileProcessingTaskInput {
  feature: FileProcessorFeature
  path: FilePath
  processorId?: FileProcessorId
}

export interface StartFileProcessingTaskResolvedInput {
  feature: FileProcessorFeature
  fileEntryId: FileEntryId
  processorId?: FileProcessorId
}

export interface StartFileProcessingTaskOptions {
  signal?: AbortSignal
}

export interface GetFileProcessingTaskInput {
  taskId: string
}

export interface GetFileProcessingTaskOptions {
  signal?: AbortSignal
}

export interface CancelFileProcessingTaskInput {
  taskId: string
}
