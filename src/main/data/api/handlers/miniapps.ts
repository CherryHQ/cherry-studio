/**
 * Miniapp API Handlers
 *
 * Implements all miniapp-related API endpoints including:
 * - Miniapp CRUD operations
 * - Reordering
 *
 * All input validation happens here at the system boundary.
 */

import { miniappService } from '@data/services/MiniAppService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { MiniappSchemas } from '@shared/data/api/schemas/miniapps'
import {
  CreateMiniappSchema,
  ListMiniappsQuerySchema,
  ReorderMiniappsSchema,
  UpdateMiniappSchema
} from '@shared/data/api/schemas/miniapps'

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
      const parsed = ListMiniappsQuerySchema.parse(query ?? {})
      return await miniappService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreateMiniappSchema.parse(body)
      return await miniappService.create(parsed)
    },
    PATCH: async ({ body }) => {
      const parsed = ReorderMiniappsSchema.parse(body)
      await miniappService.reorder(parsed.items)
      return undefined
    }
  },

  '/miniapps/:id': {
    GET: async ({ params }) => {
      return await miniappService.getByAppId(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateMiniappSchema.parse(body)
      return await miniappService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await miniappService.delete(params.id)
      return undefined
    }
  },

  '/miniapps/defaults': {
    DELETE: async () => {
      await miniappService.resetDefaults()
      return undefined
    }
  }
}
