import { application } from '@application'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentWorkspaceSchemas } from '@shared/data/api/schemas/agentWorkspaces'

export const agentWorkspaceHandlers: HandlersFor<AgentWorkspaceSchemas> = {
  '/agent-workspaces': {
    GET: async () => {
      return await agentWorkspaceService.list()
    },
    POST: async ({ body }) => {
      return await agentWorkspaceService.findOrCreateByPath(body.path, { name: body.name })
    }
  },

  '/agent-workspaces/:workspaceId': {
    GET: async ({ params }) => {
      return await agentWorkspaceService.getById(params.workspaceId)
    },
    PATCH: async ({ params, body }) => {
      return await agentWorkspaceService.update(params.workspaceId, body)
    },
    DELETE: async ({ params }) => {
      await application.get('DbService').withWriteTx((tx) => agentWorkspaceService.deleteByIdTx(tx, params.workspaceId))
      return undefined
    }
  },

  '/agent-workspaces/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await agentWorkspaceService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agent-workspaces/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await agentWorkspaceService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
