/**
 * Provider API Handlers
 *
 * Implements all provider-related API endpoints including:
 * - Provider CRUD operations
 * - Listing with filters
 */

import { providerService } from '@data/services/ProviderService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AddProviderApiKeySchema,
  CreateProviderSchema,
  ListProviderApiKeysQuerySchema,
  ListProvidersQuerySchema,
  type ProviderSchemas,
  ReplaceProviderApiKeysSchema,
  UpdateApiKeySchema,
  UpdateProviderSchema
} from '@shared/data/api/schemas/providers'
import type { HandlersFor } from '@shared/data/api/types'

export const providerHandlers: HandlersFor<ProviderSchemas> = {
  '/providers': {
    GET: async ({ query }) => {
      const parsed = ListProvidersQuerySchema.parse(query ?? {})
      return providerService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateProviderSchema.parse(body)
      return providerService.create(parsed)
    }
  },

  '/providers/:providerId': {
    GET: async ({ params }) => {
      return providerService.getByProviderId(params.providerId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateProviderSchema.parse(body)
      return providerService.update(params.providerId, parsed)
    },

    DELETE: async ({ params }) => {
      providerService.delete(params.providerId)
      return undefined
    }
  },

  '/providers/:providerId/api-keys': {
    GET: async ({ params, query }) => {
      const parsed = ListProviderApiKeysQuerySchema.parse(query ?? {})
      const keys = providerService.getApiKeys(params.providerId, parsed)
      return { keys }
    },

    POST: async ({ params, body }) => {
      const parsed = AddProviderApiKeySchema.parse(body)
      return providerService.addApiKey(params.providerId, parsed.key, parsed.label)
    },

    PUT: async ({ params, body }) => {
      const parsed = ReplaceProviderApiKeysSchema.parse(body)
      return providerService.replaceApiKeys(params.providerId, parsed.keys)
    }
  },

  '/providers/:providerId/auth-config': {
    GET: async ({ params }) => {
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
      providerService.move(params.id, parsed)
      return undefined
    }
  },

  '/providers/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      providerService.reorder(parsed.moves)
      return undefined
    }
  }
}
