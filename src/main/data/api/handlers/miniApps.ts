/**
 * MiniApp API Handlers
 *
 * Mirrors {@link providers}.ts: thin handler that dispatches to {@link MiniAppService}.
 * Website deletion runs through `mini_app.delete_site` to clear regional data.
 * {@link MiniAppSeeder} re-syncs presets at boot.
 *
 * All input validation (Zod) happens here at the system boundary.
 */

import { miniAppService } from '@data/services/MiniAppService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
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
    DELETE: async ({ params: { appId } }) => {
      const app = miniAppService.getByAppId(appId)
      const operation = `delete miniapp ${appId}`
      if (app.kind === 'app') {
        throw DataApiErrorFactory.invalidOperation(
          operation,
          'installed mini apps must be uninstalled through mini_app.uninstall'
        )
      }
      if (app.presetMiniAppId !== null) {
        throw DataApiErrorFactory.invalidOperation(
          operation,
          'preset-derived miniapp cannot be deleted. Use PATCH with status="disabled" to hide it'
        )
      }
      throw DataApiErrorFactory.invalidOperation(
        operation,
        'website mini apps must be deleted through mini_app.delete_site'
      )
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
