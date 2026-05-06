/**
 * MiniApp API Handlers
 *
 * Routes per-resource per the layered preset pattern (best-practice-layered-preset-pattern.md):
 *   - Read + merge endpoints  → MiniAppRegistryService
 *   - Custom CRUD             → also MiniAppRegistryService (which delegates to MiniAppService for write)
 *   - Reorder                 → MiniAppRegistryService (handles preset/custom split internally)
 *
 * All input validation happens here at the system boundary.
 */

import { miniAppRegistryService } from '@data/services/MiniAppRegistryService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { MiniAppSchemas } from '@shared/data/api/schemas/miniApps'
import { CreateMiniAppSchema, ListMiniAppsQuerySchema, UpdateMiniAppSchema } from '@shared/data/api/schemas/miniApps'

export const miniAppHandlers: HandlersFor<MiniAppSchemas> = {
  '/mini-apps': {
    GET: async ({ query }) => {
      const parsed = ListMiniAppsQuerySchema.parse(query ?? {})
      // ListMiniAppsQuerySchema uses `type` (alias for `kind` in API), keep mapping consistent
      return await miniAppRegistryService.list({ status: parsed.status, kind: parsed.type })
    },
    POST: async ({ body }) => {
      const parsed = CreateMiniAppSchema.parse(body)
      return await miniAppRegistryService.createCustom(parsed)
    }
  },

  '/mini-apps/:appId': {
    GET: async ({ params }) => {
      return await miniAppRegistryService.getByAppId(params.appId)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateMiniAppSchema.parse(body)
      return await miniAppRegistryService.update(params.appId, parsed)
    },
    DELETE: async ({ params }) => {
      await miniAppRegistryService.delete(params.appId)
      return undefined
    }
  },

  '/mini-apps/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await miniAppRegistryService.reorder([{ id: params.id, anchor: parsed }])
      return undefined
    }
  },

  '/mini-apps/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await miniAppRegistryService.reorder(parsed.moves)
      return undefined
    }
  }
}
