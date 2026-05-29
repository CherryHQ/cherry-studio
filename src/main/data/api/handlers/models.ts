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
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { SuccessStatus } from '@shared/data/api/apiTypes'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import {
  BulkUpdateModelsSchema,
  CreateModelsSchema,
  ListModelsQuerySchema,
  type ModelSchemas,
  ReconcileProviderModelsSchema,
  ResolveProviderModelsQuerySchema,
  UpdateModelSchema
} from '@shared/data/api/schemas/models'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('DataApi:ModelHandlers')

/**
 * Parse a UniqueModelId from the transport layer, raising a 422 validation
 * error (instead of a bare Error → 500) when the shape is malformed.
 *
 * Uses the permissive `isUniqueModelId` predicate intentionally: only "no
 * separator at all" is a transport-level error. Empty `providerId` / `modelId`
 * parts pass through to the service — this contract is pinned by handler
 * tests so callers that legitimately need that shape (delete-by-prefix
 * probes, etc.) keep working.
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
        if (!(isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)) {
          logger.error('Registry lookup failed during create', {
            providerId: dto.providerId,
            modelId: dto.modelId,
            error
          })
          throw error
        }

        logger.warn(
          dtos.length === 1
            ? 'Registry lookup missed during create, falling back to custom'
            : 'Registry lookup missed during batch create, falling back to custom',
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

export const modelHandlers: HandlersFor<ModelSchemas> = {
  '/models': {
    GET: async ({ query }) => {
      const parsed = ListModelsQuerySchema.parse(query ?? {})
      return await modelService.list(parsed)
    },

    POST: async ({ body }) => {
      // Transport is array-only by design. Even single-item create requests are
      // normalized before they reach the service so the service can expose one
      // collection-oriented create path with consistent transaction semantics.
      const parsed = CreateModelsSchema.parse(body)
      const items = await enrichCreateItems(parsed)
      return await modelService.create(items)
    },

    PATCH: async ({ body }) => {
      // Transport is array-only, matching POST /models. Each item's
      // uniqueModelId is validated up-front so a malformed entry surfaces as a
      // 422 instead of bubbling up from the service as a 500.
      const parsed = BulkUpdateModelsSchema.parse(body)
      const items = parsed.map((item) => ({
        ...parseOrValidationError(item.uniqueModelId),
        patch: item.patch
      }))
      return await modelService.bulkUpdate(items)
    }
  },

  '/models/:uniqueModelId*': {
    GET: async ({ params }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      return await modelService.getByKey(providerId, modelId)
    },

    PATCH: async ({ params, body }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      const parsed = UpdateModelSchema.parse(body)
      return await modelService.update(providerId, modelId, parsed)
    },

    DELETE: async ({ params }) => {
      const { providerId, modelId } = parseOrValidationError(params.uniqueModelId)
      await modelService.delete(providerId, modelId)
      return undefined
    }
  },

  '/providers/:providerId/models:reconcile': {
    POST: async ({ params, body }) => {
      const parsed = ReconcileProviderModelsSchema.parse(body)

      for (const dto of parsed.toAdd) {
        if (dto.providerId !== params.providerId) {
          throw DataApiErrorFactory.validation({
            providerId: [
              `toAdd item providerId '${dto.providerId}' does not match URL providerId '${params.providerId}'`
            ]
          })
        }
      }
      for (const uniqueModelId of parsed.toRemove) {
        const { providerId } = parseOrValidationError(uniqueModelId)
        if (providerId !== params.providerId) {
          throw DataApiErrorFactory.validation({
            toRemove: [`'${uniqueModelId}' providerId does not match URL providerId '${params.providerId}'`]
          })
        }
      }

      const items = await enrichCreateItems(parsed.toAdd)
      const models = await modelService.reconcileForProvider(params.providerId, {
        toAdd: items,
        toRemove: parsed.toRemove
      })
      // Override the default POST → 201: the response is the resulting
      // collection state for the provider, not a newly-created single resource.
      return { data: models, status: SuccessStatus.OK }
    }
  },

  '/providers/:providerId/models:resolve': {
    GET: async ({ params, query }) => {
      const parsed = ResolveProviderModelsQuerySchema.parse(query)
      const ids = Array.isArray(parsed.ids) ? parsed.ids : [parsed.ids]
      return await providerRegistryService.resolveModels(params.providerId, ids)
    }
  }
}
