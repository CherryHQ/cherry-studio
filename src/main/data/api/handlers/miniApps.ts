/**
 * MiniApp API Handlers
 *
 * Mirrors {@link providers}.ts: thin handler that dispatches to {@link MiniAppService}.
 * Service enforces all row-shape policy (preset-row delete guard, preset-id
 * collision rejection on create). Preset re-sync is handled by calling
 * {@link MiniAppSeeder} at boot, not here.
 *
 * All input validation (Zod) happens here at the system boundary.
 */

import { miniAppService } from '@data/services/MiniAppService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { MiniAppSchemas } from '@shared/data/api/schemas/miniApps'
import { CreateMiniAppSchema, ListMiniAppsQuerySchema, UpdateMiniAppSchema } from '@shared/data/api/schemas/miniApps'
import type { HandlersFor } from '@shared/data/api/types'

export const miniAppHandlers: HandlersFor<MiniAppSchemas> = {
  '/mini-apps': {
    GET: async ({ query }) => {
      const parsed = ListMiniAppsQuerySchema.parse(query ?? {})
      return miniAppService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreateMiniAppSchema.parse(body)
      return miniAppService.create(parsed)
    }
  },

  '/mini-apps/:appId': {
    GET: async ({ params }) => {
      return miniAppService.getByAppId(params.appId)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateMiniAppSchema.parse(body)
      return miniAppService.update(params.appId, parsed)
    },
    DELETE: async ({ params }) => {
      miniAppService.delete(params.appId)
      return undefined
    }
  },

  '/mini-apps/:id/order': {
    PATCH: async ({ params, body }) => {
      const anchor = OrderRequestSchema.parse(body)
      miniAppService.reorder([{ id: params.id, anchor }])
      return undefined
    }
  },

  '/mini-apps/order:batch': {
    PATCH: async ({ body }) => {
      const { moves } = OrderBatchRequestSchema.parse(body)
      miniAppService.reorder(moves)
      return undefined
    }
  }
}
