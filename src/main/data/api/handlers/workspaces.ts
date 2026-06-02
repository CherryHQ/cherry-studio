import { workspaceService } from '@data/services/WorkspaceService'
import { workspaceWorkflowService } from '@data/services/WorkspaceWorkflowService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  type WorkspaceSchemas
} from '@shared/data/api/schemas/workspaces'

export const workspaceHandlers: HandlersFor<WorkspaceSchemas> = {
  '/workspaces': {
    GET: async () => {
      return await workspaceService.list()
    },
    POST: async ({ body }) => {
      const { path, name } = CreateWorkspaceSchema.parse(body)
      return await workspaceService.findOrCreateByPath(path, { name })
    }
  },

  '/workspaces/:workspaceId': {
    GET: async ({ params }) => {
      return await workspaceService.getById(params.workspaceId)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateWorkspaceSchema.parse(body)
      return await workspaceService.update(params.workspaceId, parsed)
    },
    DELETE: async ({ params }) => {
      await workspaceWorkflowService.deleteWorkspace(params.workspaceId)
      return undefined
    }
  },

  '/workspaces/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await workspaceService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/workspaces/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await workspaceService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
