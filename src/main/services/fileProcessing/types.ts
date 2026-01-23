// ============================================================================
// Processing Result Type
// ============================================================================

/**
 * Processing result
 *
 * Contains the extracted text or markdown content along with metadata.
 */
export interface ProcessingResult {
  /** Extracted text content */
  text?: string
  /** Converted markdown content */
  markdown?: string
  /** Output file path (if saved to disk) */
  outputPath?: string
  /** Optional extension metadata (processor-specific) */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Processing Context Types
// ============================================================================

/**
 * Processing options
 *
 * Options that can be passed to a processing operation.
 */
export interface ProcessOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Progress callback */
  onProgress?: (progress: number) => void
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
  /** Progress callback */
  onProgress?: (progress: number) => void
}
