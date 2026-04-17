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
import { parseUniqueModelId } from '@shared/data/types/model'

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

  '/models/:uniqueModelId*': {
    GET: async ({ params }) => {
      const { providerId, modelId } = parseUniqueModelId(params.uniqueModelId)
      return await modelService.getByKey(providerId, modelId)
    },

    PATCH: async ({ params, body }) => {
      const { providerId, modelId } = parseUniqueModelId(params.uniqueModelId)
      return await modelService.update(providerId, modelId, body)
    },

    DELETE: async ({ params }) => {
      const { providerId, modelId } = parseUniqueModelId(params.uniqueModelId)
      await modelService.delete(providerId, modelId)
      return undefined
    }
  }
}
