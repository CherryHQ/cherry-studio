/**
 * File Processing API Schema definitions
 *
 * Contains file processing endpoints for:
 * - Listing available processors
 * - Reading and updating processor configuration
 */

import type { FileProcessorId, FileProcessorOverride } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * File Processing API Schema definitions
 */
export interface FileProcessingSchemas {
  /**
   * List available processors
   * @example GET /file-processing/processors
   */
  '/file-processing/processors': {
    /** Get list of available processors */
    GET: {
      response: FileProcessorMerged[]
    }
  }

  /**
   * Get or update processor configuration
   * @example GET /file-processing/processors/tesseract
   * @example PATCH /file-processing/processors/tesseract { "apiKeys": ["xxx"] }
   */
  '/file-processing/processors/:id': {
    /** Get processor configuration */
    GET: {
      params: { id: FileProcessorId }
      response: FileProcessorMerged
    }
    /** Update processor configuration */
    PATCH: {
      params: { id: FileProcessorId }
      body: FileProcessorOverride
      response: FileProcessorMerged
    }
  }
}
