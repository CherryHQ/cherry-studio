/**
 * Agent session message domain API handlers.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { projectMessagePartsForRenderer } from '@shared/ai/transport'
import { toDataApiError } from '@shared/data/api/errors'
import {
  type AgentSessionMessageEntity,
  type AgentSessionMessageSchemas,
  AgentSessionMessagesListQuerySchema,
  UpdateAgentSessionMessageSchema
} from '@shared/data/api/schemas/agentSessionMessages'
import type { HandlersFor } from '@shared/data/api/types'

/**
 * Applied only when the caller asks for it via `?deferToolOutputs`. A read returns what is stored
 * by default, so a caller that writes back what it read cannot silently persist a trimmed copy;
 * render-only callers opt in and get the small payload.
 */
function projectMessageForRenderer(message: AgentSessionMessageEntity, sessionId: string): AgentSessionMessageEntity {
  if (message.role !== 'assistant' || !message.data.parts) return message

  const parts = projectMessagePartsForRenderer(message.data.parts, buildAgentSessionTopicId(sessionId), message.id)
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
