/**
 * MiniApp API Handlers
 *
 * Implements all miniapp-related API endpoints including:
 * - MiniApp CRUD operations
 * - Reordering
 *
 * All input validation happens here at the system boundary.
 *
 * TODO(I1): Two endpoints deviate from api-design-guidelines:
 *   - PATCH /mini-apps (batch reorder) should be PUT /mini-apps/order
 *   - DELETE /mini-apps/_actions/reset-defaults should be POST /mini-apps/defaults/reset
 * Hold until a unified reorder spec is finalized.
 */

import { miniAppService } from '@data/services/MiniAppService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { MiniAppSchemas } from '@shared/data/api/schemas/miniApps'
import {
  CreateMiniAppSchema,
  ListMiniAppsQuerySchema,
  ReorderMiniAppsSchema,
  UpdateMiniAppSchema
} from '@shared/data/api/schemas/miniApps'

/**
 * Handler type for a specific miniapp endpoint
 */
type MiniAppHandler<Path extends keyof MiniAppSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * MiniApp API handlers implementation
 */
export const miniAppHandlers: {
  [Path in keyof MiniAppSchemas]: {
    [Method in keyof MiniAppSchemas[Path]]: MiniAppHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/mini-apps': {
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

  '/mini-apps/_actions/reset-defaults': {
    DELETE: async () => {
      await miniAppService.resetDefaults()
      return undefined
    }
  }
}
