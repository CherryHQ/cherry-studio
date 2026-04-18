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
import type { ModelSchemas } from '@shared/data/api/schemas/models'

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
      return await modelService.list(query ?? {})
    },

    POST: async ({ body }) => {
      const registryData = await providerRegistryService.lookupModel(body.providerId, body.modelId)
      return await modelService.create(body, registryData)
    }
  },

  '/models/:providerId/:modelId': {
    GET: async ({ params }) => {
      return await modelService.getByKey(params.providerId, params.modelId)
    },

    PATCH: async ({ params, body }) => {
      return await modelService.update(params.providerId, params.modelId, body)
    },

    DELETE: async ({ params }) => {
      await modelService.delete(params.providerId, params.modelId)
      return undefined
    }
  }
}
