import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  type AgentWorkspaceSchemas,
  CreateAgentWorkspaceSchema,
  UpdateAgentWorkspaceSchema
} from '@shared/data/api/schemas/agentWorkspaces'

export const agentWorkspaceHandlers: HandlersFor<AgentWorkspaceSchemas> = {
  '/agent-workspaces': {
    GET: async () => {
      return await agentWorkspaceService.list()
    },
    POST: async ({ body }) => {
      const parsed = CreateAgentWorkspaceSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentWorkspaceService.findOrCreateByPath(parsed.data.path, { name: parsed.data.name })
    }
  },

  '/agent-workspaces/:workspaceId': {
    GET: async ({ params }) => {
      return await agentWorkspaceService.getById(params.workspaceId)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentWorkspaceSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentWorkspaceService.update(params.workspaceId, parsed.data)
    },
    DELETE: async ({ params }) => {
      await application.get('DbService').withWriteTx(async (tx) => {
        await agentWorkspaceService.getRowByIdTx(tx, params.workspaceId)
        await agentSessionService.deleteByWorkspaceTx(tx, params.workspaceId)
        await agentWorkspaceService.deleteByIdTx(tx, params.workspaceId)
      })
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
