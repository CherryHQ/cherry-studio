/**
 * Model API Handlers
 *
 * Implements all model-related API endpoints including:
 * - Model CRUD operations
 * - Listing with filters
 */

import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import {
  CreateModelsDtoSchema,
  ListModelsQuerySchema,
  type ModelSchemas,
  UpdateModelDtoSchema
} from '@shared/data/api/schemas/models'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

/**
 * Handler type for a specific model endpoint
 */
type ModelHandler<Path extends keyof ModelSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

const logger = loggerService.withContext('DataApi:ModelHandlers')

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

async function enrichCreateItems(dtos: CreateModelDto[]) {
  return await Promise.all(
    dtos.map(async (dto) => {
      try {
        return {
          dto,
          registryData: await providerRegistryService.lookupModel(dto.providerId, dto.modelId)
        }
      } catch (error) {
        logger.warn(
          dtos.length === 1
            ? 'Registry lookup failed during create, falling back to custom'
            : 'Registry lookup failed during batch create, falling back to custom',
          {
            providerId: dto.providerId,
            modelId: dto.modelId,
            error
          }
        )
        return {
          dto,
          registryData: undefined
        }
      }
    })
  )
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
      const parsed = ListModelsQuerySchema.parse(query ?? {})
      return await modelService.list(parsed)
    },

    POST: async ({ body }) => {
      // Transport is array-only by design. Even single-item create requests are
      // normalized before they reach the service so the service can expose one
      // collection-oriented create path with consistent transaction semantics.
      const parsed = CreateModelsDtoSchema.parse(body)
      const items = await enrichCreateItems(parsed)
      return await modelService.create(items)
    }
  },

  '/models/:uniqueModelId*': {
    GET: async ({ params }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      return await modelService.getByKey(providerId, modelId)
    },

    PATCH: async ({ params, body }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      const parsed = UpdateModelDtoSchema.parse(body)
      return await modelService.update(providerId, modelId, parsed)
    },

    DELETE: async ({ params }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      await modelService.delete(providerId, modelId)
      return undefined
    }
  }
}
