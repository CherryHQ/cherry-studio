/**
 * Agent session domain API handlers.
 *
 * Sessions are pure agent instances. Cognitive config (model / instructions /
 * mcps / disabledTools / configuration) lives on the parent agent and is
 * fetched separately; the selected workspace is exposed as a normalized
 * session relation.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AgentSessionMessagesListQuerySchema,
  type AgentSessionSchemas,
  CreateAgentSessionSchema,
  DeleteAgentSessionsQuerySchema,
  ListAgentSessionsQuerySchema,
  UpdateAgentSessionSchema
} from '@shared/data/api/schemas/agentSessions'
import * as z from 'zod'

const AgentSessionsParamsSchema = z.strictObject({
  agentId: z.string().min(1)
})

export const agentSessionHandlers: HandlersFor<AgentSessionSchemas> = {
  '/agent-sessions': {
    GET: async ({ query }) => {
      const parsed = ListAgentSessionsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.listByCursor(parsed.data)
    },

    POST: async ({ body }) => {
      const parsed = CreateAgentSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.create(parsed.data)
    },

    DELETE: async ({ query }) => {
      const parsed = DeleteAgentSessionsQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.deleteByIds(parsed.data.ids)
    }
  },

  '/agent-sessions/:sessionId': {
    GET: async ({ params }) => {
      return await agentSessionService.getById(params.sessionId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.update(params.sessionId, parsed.data)
    },

    DELETE: async ({ params }) => {
      await agentSessionService.delete(params.sessionId)
      return undefined
    }
  },

  '/agent-sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const parsed = AgentSessionMessagesListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionMessageService.listSessionMessages(params.sessionId, parsed.data)
    }
  },

  '/agent-sessions/:sessionId/messages/:messageId': {
    DELETE: async ({ params }) => {
      await agentSessionMessageService.deleteSessionMessage(params.sessionId, params.messageId)
      return undefined
    }
  },

  '/agents/:agentId/sessions': {
    DELETE: async ({ params }) => {
      const parsed = AgentSessionsParamsSchema.safeParse(params)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.deleteByAgentId(parsed.data.agentId)
    }
  },

  '/agent-sessions/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await agentSessionService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agent-sessions/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await agentSessionService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
