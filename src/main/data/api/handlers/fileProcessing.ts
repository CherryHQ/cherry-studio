import { fileProcessingService } from '@data/services/FileProcessingService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { FileProcessingSchemas } from '@shared/data/api/schemas/fileProcessing'
import { FileProcessorOverrideSchema } from '@shared/data/presets/file-processing'

type FileProcessingHandler<Path extends keyof FileProcessingSchemas, Method extends ApiMethods<Path>> = ApiHandler<
  Path,
  Method
>

export const fileProcessingHandlers: {
  [Path in keyof FileProcessingSchemas]: {
    [Method in keyof FileProcessingSchemas[Path]]: FileProcessingHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/file-processing/processors': {
    GET: async () => {
      return await fileProcessingService.getProcessors()
    }
  },

  '/file-processing/processors/:id': {
    GET: async ({ params }) => {
      return await fileProcessingService.getProcessorById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const validated = FileProcessorOverrideSchema.parse(body)
      return await fileProcessingService.updateProcessor(params.id, validated)
    }
  }
}
