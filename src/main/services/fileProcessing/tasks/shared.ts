import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorInput, FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileEntryId, FileType } from '@shared/data/types/file'
import type { FileProcessingArtifact } from '@shared/data/types/fileProcessing'
import type { FileInfo } from '@shared/file/types'

import { fileProcessingArtifactPersistence } from '../persistence/FileProcessingArtifactPersistence'
import { processorRegistry } from '../processors/registry'
import type {
  FileProcessingCapabilityHandler,
  FileProcessingHandlerOutput,
  FileProcessingProcessorCapabilities
} from '../processors/types'

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

export interface FileProcessingJobOutput {
  artifacts: FileProcessingArtifact[]
}

/**
 * Project a capability output into persistable artifacts. Text outputs become
 * inline artifacts; markdown / zip outputs are written to disk by
 * FileProcessingArtifactPersistence under a per-jobId staging directory, then
 * registered as FileManager internal artifacts.
 *
 * The caller is responsible for `cleanupFileProcessingResultsDir(jobId)` on
 * failure or cancellation after this returns successfully — disk artifacts are
 * the only on-disk state outside jobTable.
 */
export async function createArtifacts(
  jobId: string,
  output: FileProcessingHandlerOutput,
  signal: AbortSignal
): Promise<FileProcessingArtifact[]> {
  return await fileProcessingArtifactPersistence.persistArtifact({
    taskId: jobId,
    output,
    signal
  })
}

export function cleanupArtifacts(jobId: string, artifacts?: FileProcessingArtifact[]): Promise<void> {
  return fileProcessingArtifactPersistence.cleanupArtifacts({ taskId: jobId, artifacts })
}

/** Look up the capability handler for (processorId, feature). Throws on missing. */
export function getCapabilityHandler<Feature extends FileProcessorFeature>(
  processorId: FileProcessorId,
  feature: Feature
): FileProcessingCapabilityHandler<Feature> {
  const capabilities: FileProcessingProcessorCapabilities = processorRegistry[processorId].capabilities
  const handler = capabilities[feature]

  if (!handler) {
    throw new Error(`File processor ${processorId} does not support ${feature}`)
  }

  return handler
}

/**
 * Guard against handler.mode vs prepared.mode drift. The orchestrator routes
 * by handler.mode at enqueue time; any divergence at execute time means a
 * capability handler was implemented incorrectly.
 */
export function assertModeMatches(
  handler: { mode: 'background' | 'remote-poll' },
  expected: 'background' | 'remote-poll'
): void {
  if (handler.mode !== expected) {
    throw new Error(
      `Internal error - Capability handler mode mismatch: handler.mode='${handler.mode}' but job type expects '${expected}'`
    )
  }
}

export function assertFileTypeSupported(
  file: FileInfo,
  feature: FileProcessorFeature,
  config: FileProcessorMerged
): void {
  const presetCapability = config.capabilities.find((item) => item.feature === feature)

  if (!presetCapability) {
    throw new Error(`File processor ${config.id} does not support ${feature}`)
  }

  if (!isSupportedFileType(file.type, presetCapability.inputs)) {
    throw new Error(`File processor ${config.id} ${feature} does not support ${file.type} files`)
  }
}

function isSupportedFileType(
  fileType: FileType,
  inputs: readonly FileProcessorInput[]
): fileType is FileProcessorInput {
  return inputs.includes(fileType as FileProcessorInput)
}
