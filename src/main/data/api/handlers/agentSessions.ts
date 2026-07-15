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
import { toDataApiError } from '@shared/data/api/errors'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AgentSessionMessagesListQuerySchema,
  type AgentSessionSchemas,
  AgentSessionStatsQuerySchema,
  CreateAgentSessionSchema,
  DeleteAgentSessionsQuerySchema,
  LatestAgentSessionQuerySchema,
  ListAgentSessionsQuerySchema,
  SetAgentSessionWorkspaceSchema,
  UpdateAgentSessionSchema
} from '@shared/data/api/schemas/agentSessions'
import type { HandlersFor } from '@shared/data/api/types'
import * as z from 'zod'

const AgentSessionsParamsSchema = z.strictObject({
  agentId: z.string().min(1)
})

export const agentSessionHandlers: HandlersFor<AgentSessionSchemas> = {
  '/agent-sessions': {
    GET: async ({ query }) => {
      const parsed = ListAgentSessionsQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.listByCursor(parsed.data)
    },

    POST: async ({ body }) => {
      const parsed = CreateAgentSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.create(parsed.data)
    },

    DELETE: async ({ query }) => {
      const parsed = DeleteAgentSessionsQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.deleteByIds(parsed.data.ids)
    }
  },

  '/agent-sessions/latest': {
    GET: async ({ query }) => {
      const parsed = LatestAgentSessionQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return { session: agentSessionService.getLatestUpdated(parsed.data) }
    }
  },

  '/agent-sessions/stats': {
    GET: async ({ query }) => {
      const parsed = AgentSessionStatsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.stats(parsed.data)
    }
  },

  '/agent-sessions/:sessionId': {
    GET: async ({ params }) => {
      return agentSessionService.getById(params.sessionId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.update(params.sessionId, parsed.data)
    },

    DELETE: async ({ params }) => {
      agentSessionService.delete(params.sessionId)
      return undefined
    }
  },

  '/agent-sessions/:sessionId/workspace': {
    PUT: async ({ params, body }) => {
      const parsed = SetAgentSessionWorkspaceSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.setWorkspace(params.sessionId, parsed.data)
    }
  },

  '/agent-sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const parsed = AgentSessionMessagesListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionMessageService.listSessionMessages(params.sessionId, parsed.data)
    }
  },

  '/agent-sessions/:sessionId/messages/:messageId': {
    DELETE: async ({ params }) => {
      agentSessionMessageService.deleteSessionMessage(params.sessionId, params.messageId)
      return undefined
    }
  },

  '/agents/:agentId/sessions': {
    DELETE: async ({ params }) => {
      const parsed = AgentSessionsParamsSchema.safeParse(params)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.deleteByAgentId(parsed.data.agentId)
    }
  },

  '/agent-sessions/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      agentSessionService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agent-sessions/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      agentSessionService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
