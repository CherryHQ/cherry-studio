// ============================================================================
// Processing Context Types (runtime-specific, kept in service)
// ============================================================================

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { ProcessingError, ProcessingResult, ProcessingStatus } from '@shared/data/types/fileProcessing'

/**
 * Processing options
 *
 * Options that can be passed to a processing operation.
 */
export interface ProcessOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Processing context
 *
 * Contains runtime context for a processing operation.
 * Passed to processors during execution.
 */
export interface ProcessingContext {
  /** Unique request ID for tracking */
  requestId: string
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

// ============================================================================
// Task State Types (internal, for async task management)
// ============================================================================

/**
 * Internal task state
 *
 * Stored in memory for tracking async processing tasks.
 * Used by FileProcessingService for task lifecycle management.
 */
export interface TaskState {
  requestId: string
  status: ProcessingStatus
  progress: number
  result?: ProcessingResult
  error?: ProcessingError
  processorId: string
  providerTaskId: string | null
  config: FileProcessorMerged
  abortController: AbortController
}
