/**
 * File Processing Domain Types
 *
 * Shared types for file processing operations used across
 * main process, renderer, and API layer.
 */

import type { FileProcessorFeature } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'

// ============================================================================
// Processing Status Types
// ============================================================================

/**
 * Processing status for async task model
 */
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

/**
 * Processing error information
 */
export interface ProcessingError {
  /** Error code (e.g., 'cancelled', 'not_found', 'processing_error') */
  code: string
  /** Human-readable error message */
  message: string
}

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
  /** Markdown file path (if saved to disk) */
  markdownPath?: string
  /** Optional extension metadata (processor-specific) */
  metadata?: Record<string, unknown>
}

/**
 * DTO for processing a file
 *
 * Contains file metadata, required feature, and optional processor ID.
 */
export interface ProcessFileDto {
  /** File metadata */
  file: FileMetadata
  /** Feature to use (required) */
  feature: FileProcessorFeature
  /** Processor ID to use (optional, uses default if not provided) */
  processorId?: string
}

// ============================================================================
// Async Task Response Types
// ============================================================================

/**
 * Response for starting a process (async model)
 *
 * Returns immediately with request ID and pending status.
 * Use getResult() to poll for completion.
 */
export interface ProcessStartResponse {
  /** Unique request ID for tracking and cancellation */
  requestId: string
  /** Initial status (always 'pending') */
  status: ProcessingStatus
}

/**
 * Response for querying process result
 *
 * Contains current status, progress, and result/error when complete.
 */
export interface ProcessResultResponse {
  /** Unique request ID */
  requestId: string
  /** Current processing status */
  status: ProcessingStatus
  /** Progress percentage (0-100) */
  progress: number
  /** Processing result (when status is 'completed') */
  result?: ProcessingResult
  /** Error information (when status is 'failed') */
  error?: ProcessingError
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
