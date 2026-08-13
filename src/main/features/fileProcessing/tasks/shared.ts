import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileHandle } from '@shared/data/types/file'
import type { FileProcessingOutputTarget } from '@shared/data/types/fileProcessing'

/**
 * JobRegistry declaration merging for file-processing job types.
 *
 * Background and remote-poll are separate because they have different recovery
 * semantics, timeouts, and (in remote-poll) cross-restart metadata shape.
 * Background is split again by `FileProcessorRuntime`: a concurrency cap is a
 * per-type knob, and one value cannot be right for both an inference worker and
 * an HTTP call. All three share an identical payload — the difference is which
 * JobHandler runs them, and under which cap.
 *
 * `'file-processing.background'` deliberately keeps its original name for the
 * *remote* half even though the local half reads as the odd one out. Job types
 * are persisted in `jobTable.type`, and a non-terminal row whose type has no
 * registered handler is cancelled outright by startup recovery — bypassing
 * `finalizeJob`, so neither `publishState` nor `onSettled` fires. Keeping the
 * old string means every row already on disk at upgrade time runs to completion
 * with exactly its pre-upgrade behaviour. Do not "fix" the asymmetry.
 */
declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'file-processing.background': FileProcessingJobPayload
    'file-processing.background-local': FileProcessingJobPayload
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

/**
 * Dispatch queue for a processor, one per processor so a slow one never blocks
 * the rest. Local and remote get separate namespaces on purpose: a queue's
 * concurrency cap is fixed by whichever job type creates it first and ignored
 * thereafter, so sharing a name across the two background types would let a
 * pre-upgrade row pin a local processor's queue at the remote cap.
 */
export function fileProcessingQueue(processorId: FileProcessorId): string {
  return `file-processing.${processorId}`
}

export function localFileProcessingQueue(processorId: FileProcessorId): string {
  return `file-processing.local.${processorId}`
}
