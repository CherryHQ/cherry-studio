/**
 * MiniApp API Handlers
 *
 * Mirrors {@link providers}.ts: thin handler that dispatches to {@link MiniAppService}.
 * Service enforces all row-shape policy (preset-row delete guard, preset-id
 * collision rejection on create). Preset re-sync is handled by
 * {@link MiniAppRegistryService.syncPresets} at boot/admin, not here.
 *
 * All input validation (Zod) happens here at the system boundary.
 */

import { miniAppService } from '@data/services/MiniAppService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { MiniAppSchemas } from '@shared/data/api/schemas/miniApps'
import { CreateMiniAppSchema, ListMiniAppsQuerySchema, UpdateMiniAppSchema } from '@shared/data/api/schemas/miniApps'

export const miniAppHandlers: HandlersFor<MiniAppSchemas> = {
  '/mini-apps': {
    GET: async ({ query }) => {
      const parsed = ListMiniAppsQuerySchema.parse(query ?? {})
      return await miniAppService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreateMiniAppSchema.parse(body)
      return await miniAppService.create(parsed)
    }
  },

  '/mini-apps/:appId': {
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

  '/mini-apps/:id/order': {
    PATCH: async ({ params, body }) => {
      const anchor = OrderRequestSchema.parse(body)
      await miniAppService.reorder([{ id: params.id, anchor }])
      return undefined
    }
  },

  '/mini-apps/order:batch': {
    PATCH: async ({ body }) => {
      const { moves } = OrderBatchRequestSchema.parse(body)
      await miniAppService.reorder(moves)
      return undefined
    }
  }
}
