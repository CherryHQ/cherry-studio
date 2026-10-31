import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileHandle } from '@shared/data/types/file'
import type { FileProcessingOutputTarget, FileProcessingTask } from '@shared/data/types/fileProcessing'
export type {
  FileProcessingArtifact,
  FileProcessingTask,
  FileProcessingTaskId,
  ListAvailableFileProcessorsResult
} from '@shared/data/types/fileProcessing'

export type SettledFileProcessingTask = Extract<FileProcessingTask, { status: 'completed' | 'failed' | 'cancelled' }>

export interface StartFileProcessingTaskInput {
  feature: FileProcessorFeature
  file: FileHandle
  output?: FileProcessingOutputTarget
  context?: {
    dataId?: string
  }
  processorId?: FileProcessorId
}

export interface StartedFileProcessingTask {
  /** The task as just queued. */
  task: FileProcessingTask
  /** Resolves once the task reaches a terminal state, in this launch only: no task survives a restart. */
  done: Promise<SettledFileProcessingTask>
}

/**
 * `timed-out`: the task reads `cancelled`, but its conversion did not stop in
 * time and may still write its output. `not-cancellable`: the task had already
 * settled, or no such task exists.
 */
export type FileProcessingTaskCancelOutcome = 'cancelled' | 'timed-out' | 'not-cancellable'
