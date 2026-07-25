/**
 * Agent session message domain API handlers.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { toDataApiError } from '@shared/data/api/errors'
import {
  type AgentSessionMessageSchemas,
  AgentSessionMessagesListQuerySchema,
  UpdateAgentSessionMessageSchema
} from '@shared/data/api/schemas/agentSessionMessages'
import type { HandlersFor } from '@shared/data/api/types'

export const agentSessionMessageHandlers: HandlersFor<AgentSessionMessageSchemas> = {
  '/agent-sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const parsed = AgentSessionMessagesListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionMessageService.listSessionMessages(params.sessionId, parsed.data)
    }
  },

  '/agent-sessions/:sessionId/messages/:messageId': {
    GET: async ({ params }) => {
      return agentSessionMessageService.getSessionMessage(params.sessionId, params.messageId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentSessionMessageSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return agentSessionMessageService.updateSessionMessage(params.sessionId, params.messageId, parsed.data)
    },

    DELETE: async ({ params }) => {
      agentSessionMessageService.deleteSessionMessage(params.sessionId, params.messageId)
      return undefined
    }
  }
}
