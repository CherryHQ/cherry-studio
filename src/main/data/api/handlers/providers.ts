/**
 * Provider API Handlers
 *
 * Implements all provider-related API endpoints including:
 * - Provider CRUD operations
 * - Listing with filters
 */

import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { getAppEdition } from '@main/utils/appEdition'
import { isProviderAvailableInEdition } from '@main/utils/providerEdition'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AddProviderApiKeySchema,
  CreateProviderSchema,
  ListProviderApiKeysQuerySchema,
  ListProvidersQuerySchema,
  ProviderPresetQuerySchema,
  type ProviderSchemas,
  ReplaceProviderApiKeysSchema,
  UpdateApiKeySchema,
  UpdateProviderSchema
} from '@shared/data/api/schemas/providers'
import type { HandlersFor } from '@shared/data/api/types'
import type { Provider } from '@shared/data/types/provider'

function requireAvailableProvider(provider: Provider): Provider {
  if (!isProviderAvailableInEdition(provider, getAppEdition())) {
    throw DataApiErrorFactory.notFound('Provider', provider.id)
  }
  return provider
}

function requireAvailableProviderById(providerId: string): Provider {
  return requireAvailableProvider(providerService.getByProviderId(providerId))
}

export const providerHandlers: HandlersFor<ProviderSchemas> = {
  '/providers': {
    GET: async ({ query }) => {
      const parsed = ListProvidersQuerySchema.parse(query ?? {})
      const edition = getAppEdition()
      return providerService.list(parsed).filter((provider) => isProviderAvailableInEdition(provider, edition))
    },

    POST: async ({ body }) => {
      const parsed = CreateProviderSchema.parse(body)
      return providerService.create(parsed)
    }
  },

  '/providers/:providerId': {
    GET: async ({ params }) => {
      return requireAvailableProviderById(params.providerId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateProviderSchema.parse(body)
      requireAvailableProviderById(params.providerId)
      return providerService.update(params.providerId, parsed)
    },

    DELETE: async ({ params }) => {
      requireAvailableProviderById(params.providerId)
      providerService.delete(params.providerId)
      return undefined
    }
  },

  '/providers/:providerId/api-keys': {
    GET: async ({ params, query }) => {
      const parsed = ListProviderApiKeysQuerySchema.parse(query ?? {})
      requireAvailableProviderById(params.providerId)
      const keys = providerService.getApiKeys(params.providerId, parsed)
      return { keys }
    },

    POST: async ({ params, body }) => {
      const parsed = AddProviderApiKeySchema.parse(body)
      requireAvailableProviderById(params.providerId)
      return providerService.addApiKey(params.providerId, parsed.key, parsed.label)
    },

    PUT: async ({ params, body }) => {
      const parsed = ReplaceProviderApiKeysSchema.parse(body)
      requireAvailableProviderById(params.providerId)
      return providerService.replaceApiKeys(params.providerId, parsed.keys)
    }
  },

  '/providers/:providerId/auth-config': {
    GET: async ({ params }) => {
      requireAvailableProviderById(params.providerId)
      const authConfig = providerService.getAuthConfig(params.providerId)
      // OAuth secrets never need to leave the main process — the renderer uses
      // `oauth.has_token` for the signed-in boolean. Whitelist only the
      // non-secret metadata (deny-by-default, so a future field can't leak a
      // secret by accident), while other auth kinds (iam-gcp/aws) still return
      // their config for the settings UI that edits them.
      if (authConfig?.type === 'oauth') {
        const { type, clientId, accountId, expiresAt } = authConfig
        return { type, clientId, accountId, expiresAt }
      }
      return authConfig
    }
  },

  '/providers/:providerId/preset': {
    GET: async ({ params, query }) => {
      const parsed = ProviderPresetQuerySchema.parse(query ?? {})
      const provider = requireAvailableProviderById(params.providerId)
      const fields = Array.isArray(parsed.fields) ? parsed.fields : [parsed.fields]
      return providerRegistryService.getProviderPreset(provider.id, fields, provider.presetProviderId ?? null)
    }
  },

  '/providers/:providerId/api-keys/:keyId': {
    PATCH: async ({ params, body }) => {
      const parsed = UpdateApiKeySchema.parse(body)
      requireAvailableProviderById(params.providerId)
      return providerService.updateApiKey(params.providerId, params.keyId, parsed)
    },

    DELETE: async ({ params }) => {
      requireAvailableProviderById(params.providerId)
      return providerService.deleteApiKey(params.providerId, params.keyId)
    }
  },

  '/providers/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      requireAvailableProviderById(params.id)
      providerService.move(params.id, parsed)
      return undefined
    }
  },

  '/providers/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      for (const move of parsed.moves) {
        requireAvailableProviderById(move.id)
      }
      providerService.reorder(parsed.moves)
      return undefined
    }
  }
}
