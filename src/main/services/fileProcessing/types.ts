// ============================================================================
// Processing Context Types (runtime-specific, kept in service)
// ============================================================================

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
