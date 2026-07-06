import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { toDataApiError } from '@shared/data/api/errors'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  type AgentWorkspaceSchemas,
  CreateAgentWorkspaceSchema,
  UpdateAgentWorkspaceSchema
} from '@shared/data/api/schemas/agentWorkspaces'
import { type HandlersFor, SuccessStatus } from '@shared/data/api/types'

export const agentWorkspaceHandlers: HandlersFor<AgentWorkspaceSchemas> = {
  '/agent-workspaces': {
    GET: async () => {
      return agentWorkspaceService.list()
    },
    POST: async ({ body }) => {
      const parsed = CreateAgentWorkspaceSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      const result = agentWorkspaceService.findOrCreateByPathResult(parsed.data.path, { name: parsed.data.name })
      return {
        data: result.workspace,
        status: result.created ? SuccessStatus.CREATED : SuccessStatus.OK
      }
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
    },
    DELETE: async ({ params }) => {
      agentSessionService.deleteWorkspaceCascade(params.workspaceId)
      return undefined
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
