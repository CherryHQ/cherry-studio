/**
 * Agent session message domain API handlers.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { projectMessagePartsForRenderer } from '@shared/ai/transport'
import { toDataApiError } from '@shared/data/api/errors'
import {
  type AgentSessionMessageEntity,
  type AgentSessionMessageSchemas,
  AgentSessionMessagesListQuerySchema,
  UpdateAgentSessionMessageSchema
} from '@shared/data/api/schemas/agentSessionMessages'
import type { HandlersFor } from '@shared/data/api/types'

/** Opt-in via `?deferToolOutputs`; a default read stays verbatim so read-modify-write is safe. */
function projectMessageForRenderer(message: AgentSessionMessageEntity, sessionId: string): AgentSessionMessageEntity {
  if (message.role !== 'assistant' || !message.data.parts) return message

  // Inline because `data/` must not import from `ai/` (main-process-architecture §3).
  const topicId = `agent-session:${sessionId}`
  const parts = projectMessagePartsForRenderer(message.data.parts, topicId, message.id)
  if (parts === message.data.parts) return message
  return { ...message, data: { ...message.data, parts } }
}

export const agentSessionMessageHandlers: HandlersFor<AgentSessionMessageSchemas> = {
  '/agent-sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const parsed = AgentSessionMessagesListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const response = agentSessionMessageService.listSessionMessages(params.sessionId, parsed.data)
      if (!parsed.data.deferToolOutputs) return response

      const items = response.items.map((item) => projectMessageForRenderer(item, params.sessionId))
      if (items.every((item, index) => item === response.items[index])) return response
      return { ...response, items }
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
