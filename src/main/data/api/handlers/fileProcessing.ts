import { fileProcessingService } from '@data/services/FileProcessingService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { FileProcessingSchemas } from '@shared/data/api/schemas/fileProcessing'
import { FileProcessorOverrideSchema } from '@shared/data/presets/file-processing'

function buildValidationErrors(bodyResult: ReturnType<typeof FileProcessorOverrideSchema.safeParse>) {
  if (bodyResult.success) {
    return {}
  }

  return bodyResult.error.issues.reduce<Record<string, string[]>>((errors, issue) => {
    const field = issue.path.map(String).join('.') || 'body'

    errors[field] ??= []
    errors[field].push(issue.message)
    return errors
  }, {})
}

export const fileProcessingHandlers: HandlersFor<FileProcessingSchemas> = {
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
      const bodyResult = FileProcessorOverrideSchema.safeParse(body)

      if (!bodyResult.success) {
        throw DataApiErrorFactory.validation(buildValidationErrors(bodyResult))
      }

      return await fileProcessingService.updateProcessor(params.id, bodyResult.data)
    }
  }
}
