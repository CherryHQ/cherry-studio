/**
 * Provider API Handlers
 *
 * Implements all provider-related API endpoints including:
 * - Provider CRUD operations
 * - Listing with filters
 */

import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  AddProviderApiKeySchema,
  CreateProviderSchema,
  ListProvidersQuerySchema,
  type ProviderSchemas,
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
      const keys = await providerService.getEnabledApiKeys(params.providerId)
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

  '/providers/:providerId/auth-config': {
    GET: async ({ params }) => {
      return providerService.getAuthConfig(params.providerId)
    }
  },

  '/providers/:providerId/api-keys/:keyId': {
    DELETE: async ({ params }) => {
      return providerService.deleteApiKey(params.providerId, params.keyId)
    }
  }
}
