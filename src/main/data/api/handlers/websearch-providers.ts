/**
 * WebSearch Provider API Handlers
 *
 * Implements all websearch provider-related API endpoints including:
 * - Provider CRUD operations
 * - Connection testing
 */

import { websearchProviderService } from '@data/services/WebSearchProviderService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { WebSearchProviderSchemas } from '@shared/data/api/schemas/websearch-providers'

/**
 * Handler type for a specific websearch provider endpoint
 */
type ProviderHandler<Path extends keyof WebSearchProviderSchemas, Method extends ApiMethods<Path>> = ApiHandler<
  Path,
  Method
>

/**
 * WebSearch Provider API handlers implementation
 */
export const websearchProviderHandlers: {
  [Path in keyof WebSearchProviderSchemas]: {
    [Method in keyof WebSearchProviderSchemas[Path]]: ProviderHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/websearch-providers': {
    GET: async ({ query }) => {
      const { page = 1, limit = 10 } = query ?? {}
      return await websearchProviderService.list({ page, limit })
    }
  },

  '/websearch-providers/:id': {
    GET: async ({ params }) => {
      return await websearchProviderService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      return await websearchProviderService.update(params.id, body)
    }
  },

  '/websearch-providers/:id/test': {
    POST: async ({ params }) => {
      return await websearchProviderService.testConnection(params.id)
    }
  }
}
