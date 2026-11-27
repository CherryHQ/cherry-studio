import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { toDataApiError } from '@shared/data/api/errors'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import { type AgentWorkspaceSchemas, UpdateAgentWorkspaceSchema } from '@shared/data/api/schemas/agentWorkspaces'
import { type HandlersFor } from '@shared/data/api/types'

export const agentWorkspaceHandlers: HandlersFor<AgentWorkspaceSchemas> = {
  '/agent-workspaces': {
    GET: async () => {
      return agentWorkspaceService.list()
    }
  },

  '/agent-workspaces/:workspaceId': {
    GET: async ({ params }) => {
      return agentWorkspaceService.getById(params.workspaceId)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentWorkspaceSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentWorkspaceService.update(params.workspaceId, parsed.data)
    }
  },

  '/agent-workspaces/:workspaceId/references': {
    GET: async ({ params }) => {
      return agentWorkspaceService.getReferences(params.workspaceId)
    }
  },

  '/agent-workspaces/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      agentWorkspaceService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agent-workspaces/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      agentWorkspaceService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
