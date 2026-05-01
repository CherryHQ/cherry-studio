/**
 * MiniApp API Handlers
 *
 * Implements all miniapp-related API endpoints including:
 * - MiniApp CRUD operations
 * - Reordering
 *
 * All input validation happens here at the system boundary.
 */

import { miniAppService } from '@data/services/MiniAppService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { MiniAppSchemas } from '@shared/data/api/schemas/miniApps'
import {
  CreateMiniAppSchema,
  ListMiniAppsQuerySchema,
  ReorderMiniAppsSchema,
  UpdateMiniAppSchema
} from '@shared/data/api/schemas/miniApps'

export const miniappHandlers: HandlersFor<MiniAppSchemas> = {
  '/miniapps': {
    GET: async ({ query }) => {
      const parsed = ListMiniAppsQuerySchema.parse(query ?? {})
      return await miniAppService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreateMiniAppSchema.parse(body)
      return await miniAppService.create(parsed)
    },
    PATCH: async ({ body }) => {
      const parsed = ReorderMiniAppsSchema.parse(body)
      await miniAppService.reorder(parsed.items)
      return undefined
    }
  },

  '/miniapps/:appId': {
    GET: async ({ params }) => {
      return await miniAppService.getByAppId(params.appId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateMiniAppSchema.parse(body)
      return await miniAppService.update(params.appId, parsed)
    },

    DELETE: async ({ params }) => {
      await miniAppService.delete(params.appId)
      return undefined
    }
  },

  '/miniapps/_actions/reset-defaults': {
    DELETE: async () => {
      await miniAppService.resetDefaults()
      return undefined
    }
  }
}
