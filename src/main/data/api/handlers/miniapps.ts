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
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { MiniappSchemas } from '@shared/data/api/schemas/miniapps'
import {
  CreateMiniappSchema,
  ListMiniappsQuerySchema,
  ReorderMiniappsSchema,
  UpdateMiniappSchema
} from '@shared/data/api/schemas/miniapps'

export const miniappHandlers: HandlersFor<MiniappSchemas> = {
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
