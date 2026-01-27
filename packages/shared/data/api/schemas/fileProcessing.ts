/**
 * File Processing API Schema definitions
 *
 * Contains all file processing-related endpoints for:
 * - Listing available processors
 * - Processing files (async requests)
 * - Querying processing request status
 */

import type {
  FileProcessorFeature,
  FileProcessorMerged,
  FileProcessorOverride
} from '@shared/data/presets/fileProcessing'
import type { ProcessFileDto, ProcessResultResponse, ProcessStartResponse } from '@shared/data/types/fileProcessing'

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * File Processing API Schema definitions
 */
export interface FileProcessingSchemas {
  /**
   * List available processors
   * @example GET /file-processing/processors?feature=text_extraction
   */
  '/file-processing/processors': {
    /** Get list of available processors */
    GET: {
      query?: {
        feature?: FileProcessorFeature
      }
      response: FileProcessorMerged[]
    }
  }

  /**
   * Get or update processor configuration
   * @example GET /file-processing/processors/tesseract
   * @example PATCH /file-processing/processors/tesseract { "apiKey": "xxx" }
   */
  '/file-processing/processors/:id': {
    /** Get processor configuration */
    GET: {
      params: { id: string }
      response: FileProcessorMerged | null
    }
    /** Update processor configuration */
    PATCH: {
      params: { id: string }
      body: FileProcessorOverride
      response: FileProcessorMerged
    }
  }

  /**
   * Processing requests collection
   * @example POST /file-processing/requests { "file": {...}, "feature": "text_extraction" }
   */
  '/file-processing/requests': {
    /** Create a new processing request (async task) */
    POST: {
      body: ProcessFileDto
      response: ProcessStartResponse
    }
  }

  /**
   * Individual processing request resource
   * @example GET /file-processing/requests/fp_123456
   */
  '/file-processing/requests/:requestId': {
    /** Get processing status and result */
    GET: {
      params: { requestId: string }
      response: ProcessResultResponse
    }
  }
}
