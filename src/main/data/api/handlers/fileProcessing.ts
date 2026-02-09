/**
 * File Processing API Handlers
 *
 * Implements all file processing-related API endpoints including:
 * - Listing available processors
 * - Updating processor configuration
 * - Creating processing requests (async)
 * - Querying processing request status/result
 */
import { fileProcessingService } from '@main/services/fileProcessing'
import { DataApiErrorFactory } from '@shared/data/api/apiErrors'
import { type ApiHandler, type ApiMethods, SuccessStatus } from '@shared/data/api/apiTypes'
import type { FileProcessingSchemas } from '@shared/data/api/schemas/fileProcessing'
import type { FileProcessorFeature } from '@shared/data/presets/file-processing'

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

  '/file-processing/processors/:id': {
    GET: async ({ params }) => {
      const processor = fileProcessingService.getProcessor(params.id)
      if (!processor) {
        throw DataApiErrorFactory.notFound('Processor', params.id)
      }
      return processor
    },
    PATCH: async ({ params, body }) => {
      return fileProcessingService.updateProcessorConfig(params.id, body)
    }
  },

  '/file-processing/requests': {
    POST: async ({ body }) => {
      const result = await fileProcessingService.startProcess(body)
      return { data: result, status: SuccessStatus.ACCEPTED }
    }
  },

  '/file-processing/requests/:requestId': {
    GET: async ({ params }) => {
      return await fileProcessingService.getResult(params.requestId)
    }
  }
}
