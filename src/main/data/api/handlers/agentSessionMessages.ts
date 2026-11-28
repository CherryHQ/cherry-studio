/**
 * Agent session message domain API handlers.
 */

import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { readChildPage } from '@main/ai/agentSession/childArchive'
import { readHistoryActions } from '@main/ai/agentSession/fork'
import { toDataApiError } from '@shared/data/api/errors'
import {
  AgentSessionMessageReadQuerySchema,
  type AgentSessionMessageSchemas,
  AgentSessionMessagesListQuerySchema,
  SelectAgentSessionBranchSchema,
  UpdateAgentSessionMessageSchema
} from '@shared/data/api/schemas/agentSessionMessages'
import type { HandlersFor } from '@shared/data/api/types'

export const agentSessionMessageHandlers: HandlersFor<AgentSessionMessageSchemas> = {
  '/agent-sessions/:sessionId/children/:toolCallId/history': {
    GET: async ({ params, query }) => {
      agentSessionService.getConversationById(params.sessionId)
      const context = contexts.childArchive(params.sessionId, params.toolCallId)
      if (!context || !query?.before) return { items: [] }
      const page = readChildPage(context, query.cursor ?? query.before)
      return { items: [...page.messages], nextCursor: page.olderCursor }
    }
  },
  '/agent-sessions/:sessionId/cost': {
    GET: async ({ params }) => {
      agentSessionService.getConversationById(params.sessionId)
      return agentSessionMessageService.getSessionCost(params.sessionId)
    }
  },

  '/agent-sessions/:sessionId/branch': {
    PUT: async ({ params, body }) => {
      agentSessionService.getConversationById(params.sessionId)
      const parsed = SelectAgentSessionBranchSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      agentSessionMessageService.selectBranch(params.sessionId, parsed.data.messageId)
    }
  },
  '/agent-sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      // Message routes scope like session reads: background sessions are not addressable here.
      agentSessionService.getConversationById(params.sessionId)
      const parsed = AgentSessionMessagesListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const response = agentSessionMessageService.listSessionMessages(params.sessionId, parsed.data)
      const actions = readHistoryActions(
        params.sessionId,
        response.items.map((item) => item.id)
      )
      const items = response.items.map((item) => ({
        ...item,
        historyActions: actions.get(item.id)
      }))
      return { ...response, items }
    }
  },

  '/agent-sessions/:sessionId/messages/:messageId': {
    GET: async ({ params, query }) => {
      const { sessionId, messageId } = params
      agentSessionService.getConversationById(sessionId)
      const parsed = AgentSessionMessageReadQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const row = agentSessionMessageService.getSessionMessage(sessionId, messageId, parsed.data)
      if (!parsed.data.deferToolOutputs) return row
      return { ...row, historyActions: readHistoryActions(sessionId, [messageId]).get(messageId) }
    },

    PATCH: async ({ params, body }) => {
      agentSessionService.getConversationById(params.sessionId)
      const parsed = UpdateAgentSessionMessageSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionMessageService.updateSessionMessage(params.sessionId, params.messageId, parsed.data)
    },

    DELETE: async ({ params }) => {
      agentSessionService.getConversationById(params.sessionId)
      agentSessionMessageService.deleteSessionMessage(params.sessionId, params.messageId)
      return undefined
    }
  }
}
