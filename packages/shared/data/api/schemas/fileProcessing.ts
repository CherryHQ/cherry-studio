/**
 * File Processing API Schema definitions
 *
 * Contains all file processing-related endpoints for:
 * - Listing available processors
 * - Processing files
 * - Cancelling processing requests
 */

import type {
  FileProcessorFeature,
  FileProcessorMerged,
  FileProcessorOverride
} from '@shared/data/presets/fileProcessing'
import type {
  CancelResponse,
  ProcessFileDto,
  ProcessResultResponse,
  ProcessStartResponse
} from '@shared/data/types/fileProcessing'

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
   * Process a file
   * @example POST /file-processing/process { "file": {...}, "feature": "text_extraction", "processorId": "tesseract" }
   */
  '/file-processing/process': {
    /** Process a file using specified or default processor */
    POST: {
      body: ProcessFileDto
      response: ProcessStartResponse
    }
  }

  /**
   * Query processing result/status
   * @example GET /file-processing/result?requestId=fp_123456
   */
  '/file-processing/result': {
    /** Get processing status and result */
    GET: {
      query: {
        requestId: string
      }
      response: ProcessResultResponse
    }
  }

  /**
   * Cancel a processing request
   * @example POST /file-processing/cancel { "requestId": "fp_123456_abc" }
   */
  '/file-processing/cancel': {
    /** Cancel an active processing request */
    POST: {
      body: {
        requestId: string
      }
      response: CancelResponse
    }
  }
}
