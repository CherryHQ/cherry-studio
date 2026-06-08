import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessingOutputTarget } from '@shared/data/types/fileProcessing'
import type { FileHandle } from '@shared/file/types'
export type {
  FileProcessingArtifact,
  FileProcessingJobOutput,
  ListAvailableFileProcessorsResult
} from '@shared/data/types/fileProcessing'

export interface StartFileProcessingJobInput {
  feature: FileProcessorFeature
  file: FileHandle
  output?: FileProcessingOutputTarget
  context?: {
    dataId?: string
  }
  processorId?: FileProcessorId
}
