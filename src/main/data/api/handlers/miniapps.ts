/**
 * Miniapp API Handlers
 *
 * Implements all miniapp-related API endpoints including:
 * - Miniapp CRUD operations
 * - Status management
 * - Reordering
 */

import { miniappService } from '@data/services/MiniappService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { MiniappSchemas } from '@shared/data/api/schemas/miniapps'

/**
 * Handler type for a specific miniapp endpoint
 */
type MiniappHandler<Path extends keyof MiniappSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Miniapp API handlers implementation
 */
export const miniappHandlers: {
  [Path in keyof MiniappSchemas]: {
    [Method in keyof MiniappSchemas[Path]]: MiniappHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/miniapps': {
    GET: async ({ query }) => {
      const { items } = await miniappService.list(query ?? {})
      return items
    },
    POST: async ({ body }) => {
      return await miniappService.create(body)
    },
    PATCH: async ({ body }) => {
      await miniappService.reorder(body.items)
      return undefined
    }
  },

  '/miniapps/:appId': {
    GET: async ({ params }) => {
      return await miniappService.getByAppId(params.appId)
    },

    PATCH: async ({ params, body }) => {
      return await miniappService.update(params.appId, body)
    },

    DELETE: async ({ params }) => {
      await miniappService.delete(params.appId)
      return undefined
    }
  },

  '/miniapps/:appId/status': {
    PUT: async ({ params, body }) => {
      const miniapp = await miniappService.updateStatus(params.appId, body.status)
      return { miniapp }
    }
  }
}
