/**
 * File Processing API Handlers
 *
 * Implements all file processing-related API endpoints including:
 * - Listing available processors
 * - Processing files
 * - Cancelling processing requests
 */
import { fileProcessingService } from '@main/services/fileProcessing'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { FileProcessingSchemas } from '@shared/data/api/schemas/fileProcessing'
import type { FileProcessorFeature } from '@shared/data/presets/fileProcessing'

/**
 * Handler type for a specific file processing endpoint
 */
type FileProcessingHandler<Path extends keyof FileProcessingSchemas, Method extends ApiMethods<Path>> = ApiHandler<
  Path,
  Method
>

/**
 * File Processing API handlers implementation
 */
export const fileProcessingHandlers: {
  [Path in keyof FileProcessingSchemas]: {
    [Method in keyof FileProcessingSchemas[Path]]: FileProcessingHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/file-processing/processors': {
    GET: async ({ query }) => {
      const q = (query || {}) as { feature?: FileProcessorFeature }
      return await fileProcessingService.listAvailableProcessors(q.feature)
    }
  },

  '/file-processing/process': {
    POST: async ({ body }) => {
      return await fileProcessingService.process(body.file, body.request)
    }
  },

  '/file-processing/cancel': {
    POST: async ({ body }) => {
      return fileProcessingService.cancel(body.requestId)
    }
  }
}
