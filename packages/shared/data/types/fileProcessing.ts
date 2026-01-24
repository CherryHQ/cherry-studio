/**
 * File Processing Domain Types
 *
 * Shared types for file processing operations used across
 * main process, renderer, and API layer.
 */

import type { FileProcessorFeature } from '@shared/data/presets/fileProcessing'

// ============================================================================
// Processing Result Types
// ============================================================================

/**
 * Processing result - output of file processing operations
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

/**
 * Request options for processing a file
 */
export interface ProcessFileRequest {
  /** Processor ID to use (optional, uses default if not provided) */
  processorId?: string
  /** Feature to use (optional, defaults based on input type) */
  feature?: FileProcessorFeature
}

/**
 * Process response - returned by process operation
 *
 * Contains the request ID for tracking/cancellation and the processing result.
 */
export interface ProcessResponse {
  /** Unique request ID for tracking and cancellation */
  requestId: string
  /** Processing result */
  result: ProcessingResult
}

/**
 * Cancel response - returned by cancel operation
 */
export interface CancelResponse {
  /** Whether the cancellation was successful */
  success: boolean
  /** Message describing the result */
  message: string
}
