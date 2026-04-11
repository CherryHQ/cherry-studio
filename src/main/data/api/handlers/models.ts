/**
 * Model API Handlers
 *
 * Implements all model-related API endpoints including:
 * - Model CRUD operations
 * - Listing with filters
 */

import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import {
  CreateModelDtoSchema,
  CreateModelsBatchDtoSchema,
  ListModelsQuerySchema,
  type ModelSchemas,
  UpdateModelDtoSchema
} from '@shared/data/api/schemas/models'

/**
 * Handler type for a specific model endpoint
 */
type ModelHandler<Path extends keyof ModelSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Model API handlers implementation
 */
export const modelHandlers: {
  [Path in keyof ModelSchemas]: {
    [Method in keyof ModelSchemas[Path]]: ModelHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/models': {
    GET: async ({ query }) => {
      const parsed = ListModelsQuerySchema.parse(query ?? {})
      return await modelService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateModelDtoSchema.parse(body)
      const registryData = await providerRegistryService.lookupModel(parsed.providerId, parsed.modelId)
      return await modelService.create(parsed, registryData)
    }
  },

  '/models/batch': {
    POST: async ({ body }) => {
      const parsed = CreateModelsBatchDtoSchema.parse(body)
      const items = await Promise.all(
        parsed.items.map(async (dto) => ({
          dto,
          registryData: await providerRegistryService.lookupModel(dto.providerId, dto.modelId)
        }))
      )

      return await modelService.batchCreate(items)
    }
  },

  '/models/:providerId/:modelId': {
    GET: async ({ params }) => {
      return await modelService.getByKey(params.providerId, params.modelId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateModelDtoSchema.parse(body)
      return await modelService.update(params.providerId, params.modelId, parsed)
    },

    DELETE: async ({ params }) => {
      await modelService.delete(params.providerId, params.modelId)
      return undefined
    }
  }
}
