/**
 * Agent session domain API handlers.
 *
 * Sessions are agent instances with a per-session model override (`model`,
 * null follows the parent agent). Remaining cognitive config (instructions /
 * mcps / disabledTools / configuration) lives on the parent agent and is
 * fetched separately; the selected workspace is exposed as a normalized
 * session relation.
 */

import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  type AgentSessionSchemas,
  CreateAgentSessionSchema,
  GetAgentSessionQuerySchema,
  LatestAgentSessionQuerySchema,
  ListAgentSessionsQuerySchema,
  SetAgentSessionWorkspaceSchema,
  UpdateAgentSessionSchema
} from '@shared/data/api/schemas/agentSessions'
import type { HandlersFor } from '@shared/data/api/types'

export const agentSessionHandlers: HandlersFor<AgentSessionSchemas> = {
  '/agent-sessions': {
    GET: async ({ query }) => {
      const parsed = ListAgentSessionsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.listByCursor({ ...parsed.data, scope: 'ordinary' })
    },

    POST: async ({ body }) => {
      const parsed = CreateAgentSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.create(parsed.data)
    }
  },

  '/agent-sessions/latest': {
    GET: async ({ query }) => {
      const parsed = LatestAgentSessionQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return { session: agentSessionService.getLatestActive(parsed.data) }
    }
  },

  '/agent-sessions/:sessionId': {
    GET: async ({ params, query }) => {
      const parsed = GetAgentSessionQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.getConversationById(params.sessionId, parsed.data)
    },

    PATCH: async ({ params, body }) => {
      // Mutations scope like reads: background sessions are not addressable here.
      agentSessionService.getConversationById(params.sessionId)
      const parsed = UpdateAgentSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.update(params.sessionId, parsed.data)
    }
  },

  '/agent-sessions/:sessionId/workspace': {
    PUT: async ({ params, body }) => {
      agentSessionService.getConversationById(params.sessionId)
      // Swapping the directory under a running turn would re-resolve its paths
      // mid-execution, so a rebind is rejected only while a turn is in flight.
      if (application.get('AgentSessionRuntimeService').isSessionBusy(params.sessionId)) {
        throw DataApiErrorFactory.invalidOperation('update session workspace', 'turn_in_flight')
      }
      const parsed = SetAgentSessionWorkspaceSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionService.setWorkspace(params.sessionId, parsed.data)
    }
  },

  '/agent-sessions/:id/order': {
    PATCH: async ({ params, body }) => {
      // Mutations scope like reads: background sessions are not addressable here.
      agentSessionService.getConversationById(params.id)
      const parsed = OrderRequestSchema.parse(body)
      agentSessionService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/agent-sessions/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      // Mutations scope like reads: background sessions are not addressable here.
      parsed.moves.forEach((move) => agentSessionService.getConversationById(move.id))
      agentSessionService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
