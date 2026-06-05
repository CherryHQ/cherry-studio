import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { WorkspaceSchemas } from '@shared/data/api/schemas/workspaces'

export const workspaceHandlers: HandlersFor<WorkspaceSchemas> = {
  '/workspaces': {
    GET: async () => {
      return await agentWorkspaceService.list()
    }
  },

  '/workspaces/:workspaceId': {
    GET: async ({ params }) => {
      return await agentWorkspaceService.getById(params.workspaceId)
    }
  },

  '/workspaces/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await agentWorkspaceService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/workspaces/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await agentWorkspaceService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
