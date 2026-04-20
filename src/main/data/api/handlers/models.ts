/**
 * Model API Handlers
 *
 * Implements all model-related API endpoints including:
 * - Model CRUD operations
 * - Listing with filters
 */

import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { ModelSchemas } from '@shared/data/api/schemas/models'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

/**
 * Handler type for a specific model endpoint
 */
type ModelHandler<Path extends keyof ModelSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Parse a UniqueModelId from the transport layer, raising a 422 validation
 * error (instead of a bare Error → 500) when the shape is malformed.
 */
const parseOrValidationError = (uniqueModelId: string) => {
  if (!isUniqueModelId(uniqueModelId)) {
    throw DataApiErrorFactory.validation({
      uniqueModelId: [`Expected "providerId::modelId", got "${uniqueModelId}"`]
    })
  }
  return parseUniqueModelId(uniqueModelId)
}

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
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      return await modelService.getByKey(providerId, modelId)
    },

    PATCH: async ({ params, body }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      return await modelService.update(providerId, modelId, body)
    },

    DELETE: async ({ params }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      await modelService.delete(providerId, modelId)
      return undefined
    }
  }
}
