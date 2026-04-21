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
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateProviderDto, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { ProviderSchemas } from '@shared/data/api/schemas/providers'
import * as z from 'zod'

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
      return await providerService.list(query ?? {})
    },

    POST: async ({ body }) => {
      const parsed = userProviderInsertSchema.safeParse(body)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({ body: [parsed.error.message] })
      }
      return await providerService.create(parsed.data as CreateProviderDto)
    }
  },

  '/providers/:providerId': {
    GET: async ({ params }) => {
      return await providerService.getByProviderId(params.providerId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = userProviderInsertSchema.partial().safeParse(body)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({ body: [parsed.error.message] })
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
      const AddApiKeySchema = z.object({ key: z.string().min(1), label: z.string().optional() })
      const parsed = AddApiKeySchema.safeParse(body)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({ key: [parsed.error.issues[0]?.message ?? 'Invalid input'] })
      }
      return await providerService.addApiKey(params.providerId, parsed.data.key, parsed.data.label)
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
  },

  '/providers/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({ body: [parsed.error.message] })
      }
      await providerService.move(params.id, parsed.data)
      return undefined
    }
  },

  '/providers/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({ body: [parsed.error.message] })
      }
      await providerService.reorder(parsed.data.moves)
      return undefined
    }
  }
}
