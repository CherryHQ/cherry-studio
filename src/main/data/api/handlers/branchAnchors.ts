/**
 * Branch Anchor API Handlers
 *
 * P2 asset-realization persistence:
 * - List anchors by PARENT topic (single read, no disposition filter)
 * - Branch anchor CRUD (create / patch summary+disposition / delete)
 */

import { branchAnchorService } from '@data/services/BranchAnchorService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  type BranchAnchorSchemas,
  CreateBranchAnchorSchema,
  UpdateBranchAnchorSchema
} from '@shared/data/api/schemas/branchAnchors'

export const branchAnchorHandlers: HandlersFor<BranchAnchorSchemas> = {
  '/topics/:id/branch-anchors': {
    GET: async ({ params }) => {
      return await branchAnchorService.listByParent(params.id)
    }
  },

  '/branch-anchors': {
    POST: async ({ body }) => {
      const parsed = CreateBranchAnchorSchema.parse(body)
      return await branchAnchorService.create(parsed)
    }
  },

  '/branch-anchors/:id': {
    PATCH: async ({ params, body }) => {
      const parsed = UpdateBranchAnchorSchema.parse(body)
      return await branchAnchorService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await branchAnchorService.delete(params.id)
      return undefined
    }
  }
}
