import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileEntryId } from '@shared/data/types/file'

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
  fileEntryId: FileEntryId
  processorId: FileProcessorId
}
