import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessingOutputTarget } from '@shared/data/types/fileProcessing'
import type { FileHandle } from '@shared/file/types'

/**
 * JobRegistry declaration merging for file-processing job types.
 *
 * Two types are needed because background and remote-poll have different
 * recovery semantics, timeouts, and (in remote-poll) cross-restart metadata
 * shape. They share an identical payload type — the difference is which
 * JobHandler runs them.
 */
declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'file-processing.background': FileProcessingJobPayload
    'file-processing.remote-poll': FileProcessingJobPayload
  }
}

export interface FileProcessingJobPayload {
  feature: FileProcessorFeature
  file: FileHandle
  output?: FileProcessingOutputTarget
  context?: {
    dataId?: string
  }
  processorId: FileProcessorId
}
