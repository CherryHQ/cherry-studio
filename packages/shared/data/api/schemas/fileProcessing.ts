/**
 * File Processing API Schema definitions
 *
 * Contains all file processing-related endpoints for:
 * - Listing available processors
 * - Processing files
 * - Cancelling processing requests
 */

import type { FileProcessorFeature, FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { CancelResponse, ProcessFileRequest, ProcessResponse } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

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
   * Process a file
   * @example POST /file-processing/process { "file": {...}, "processorId": "tesseract" }
   */
  '/file-processing/process': {
    /** Process a file using specified or default processor */
    POST: {
      body: {
        file: FileMetadata
        request?: ProcessFileRequest
      }
      response: ProcessResponse
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
