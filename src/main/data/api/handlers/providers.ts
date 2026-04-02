/**
 * Provider API Handlers
 *
 * Implements all provider-related API endpoints including:
 * - Provider CRUD operations
 * - Listing with filters
 *
 * Runtime validation uses the ORM-derived Zod schema (userProviderInsertSchema)
 * so the DB table definition is the single source of truth.
 */

import { userProviderInsertSchema } from '@data/db/schemas/userProvider'
import { catalogService } from '@data/services/ProviderCatalogService'
import { providerService } from '@data/services/ProviderService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import { ApiKeyEntrySchema } from '@shared/data/types/provider'
import { z } from 'zod'
import type { CreateProviderDto, ListProvidersQuery, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { ProviderSchemas } from '@shared/data/api/schemas/providers'

/**
 * Handler type for a specific provider endpoint
 */
type ProviderHandler<Path extends keyof ProviderSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Provider API handlers implementation
 */
export const providerHandlers: {
  [Path in keyof ProviderSchemas]: {
    [Method in keyof ProviderSchemas[Path]]: ProviderHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/providers': {
    GET: async ({ query }) => {
      const q = (query || {}) as ListProvidersQuery
      return await providerService.list(q)
    },

    POST: async ({ body }) => {
      const parsed = userProviderInsertSchema.safeParse(body)
      if (!parsed.success) {
        throw new Error(`Invalid provider data: ${parsed.error.message}`)
      }
      return await providerService.create(parsed.data as CreateProviderDto)
    }
  },

  '/providers/:providerId': {
    GET: async ({ params }) => {
      return await providerService.getByProviderId(params.providerId)
    },

    PATCH: async ({ params, body }) => {
      // Use a relaxed schema for PATCH: apiKeys entries may omit 'key'
      // (existing entries from Runtime don't have key values — smart merge fills them in service layer)
      const patchApiKeySchema = ApiKeyEntrySchema.extend({
        key: z.string().optional()
      })
      const patchBodySchema = userProviderInsertSchema.partial().extend({
        apiKeys: z.array(patchApiKeySchema).nullable().optional()
      })

      const parsed = patchBodySchema.safeParse(body)
      if (!parsed.success) {
        throw new Error(`Invalid provider update data: ${parsed.error.message}`)
      }
      return await providerService.update(params.providerId, parsed.data as UpdateProviderDto)
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
      const { key, label } = body as { key: string; label?: string }
      if (!key || typeof key !== 'string') {
        throw new Error('API key value is required')
      }
      return await providerService.addApiKey(params.providerId, key, label)
    }
  },

  '/providers/:providerId/catalog-models': {
    GET: async ({ params }) => {
      return catalogService.getCatalogModelsForProvider(params.providerId)
    }
  },

  '/providers/:providerId/auth-config': {
    GET: async ({ params }) => {
      return await providerService.getAuthConfig(params.providerId)
    }
  },

  '/providers/:providerId/api-keys/:keyId': {
    DELETE: async ({ params }) => {
      return await providerService.removeApiKey(params.providerId, params.keyId)
    }
  }
}
