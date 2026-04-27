/**
 * Provider API Handlers
 *
 * Implements all provider-related API endpoints including:
 * - Provider CRUD operations
 * - Listing with filters
 */

import { modelSyncService } from '@data/services/ModelSyncService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AddProviderApiKeySchema,
  CreateProviderSchema,
  ListProvidersQuerySchema,
  ModelSyncApplySchema,
  type ProviderSchemas,
  UpdateApiKeySchema,
  UpdateProviderSchema
} from '@shared/data/api/schemas/providers'

export const providerHandlers: HandlersFor<ProviderSchemas> = {
  '/providers': {
    GET: async ({ query }) => {
      const parsed = ListProvidersQuerySchema.parse(query ?? {})
      return await providerService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateProviderSchema.parse(body)
      return await providerService.create(parsed)
    }
  },

  '/providers/:providerId': {
    GET: async ({ params }) => {
      return await providerService.getByProviderId(params.providerId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateProviderSchema.parse(body)
      return await providerService.update(params.providerId, parsed)
    },

    DELETE: async ({ params }) => {
      await providerService.delete(params.providerId)
      return undefined
    }
  },

  '/providers/:providerId/rotated-key': {
    GET: async ({ params }) => {
      const apiKey = await providerService.getRotatedApiKey(params.providerId)
      return { apiKey }
    }
  },

  '/providers/:providerId/api-keys': {
    GET: async ({ params }) => {
      const keys = await providerService.getApiKeys(params.providerId)
      return { keys }
    },

    POST: async ({ params, body }) => {
      const parsed = AddProviderApiKeySchema.parse(body)
      return await providerService.addApiKey(params.providerId, parsed.key, parsed.label)
    }
  },

  '/providers/:providerId/registry-models': {
    GET: async ({ params }) => {
      return providerRegistryService.getRegistryModelsByProvider(params.providerId)
    },

    POST: async ({ params, body }) => {
      return await providerRegistryService.resolveModels(
        params.providerId,
        body.models.map((m) => m.modelId)
      )
    }
  },

  '/providers/:providerId/model-sync:apply': {
    POST: async ({ params, body }) => {
      const parsed = ModelSyncApplySchema.parse(body ?? {})
      return await modelSyncService.apply(params.providerId, parsed)
    }
  },

  '/providers/:providerId/auth-config': {
    GET: async ({ params }) => {
      return providerService.getAuthConfig(params.providerId)
    }
  },

  '/providers/:providerId/preset-metadata': {
    GET: async ({ params }) => {
      return providerRegistryService.getProviderPresetMetadata(params.providerId)
    }
  },

  '/providers/:providerId/api-keys/:keyId': {
    PATCH: async ({ params, body }) => {
      const parsed = UpdateApiKeySchema.parse(body)
      return providerService.updateApiKey(params.providerId, params.keyId, parsed)
    },

    DELETE: async ({ params }) => {
      return providerService.deleteApiKey(params.providerId, params.keyId)
    }
  },

  '/providers/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await providerService.move(params.id, parsed)
      return undefined
    }
  },

  '/providers/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await providerService.reorder(parsed.moves)
      return undefined
    }
  }
}
