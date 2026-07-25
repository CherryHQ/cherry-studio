/**
 * Agent session message domain API handlers.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { projectAgentMessagePartForRenderer } from '@data/services/utils/agentSessionMessageProjection'
import type { AgentSessionToolResult } from '@shared/ai/transport'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import {
  type AgentSessionMessageEntity,
  type AgentSessionMessageSchemas,
  AgentSessionMessagesListQuerySchema,
  type AgentSessionToolResultResponse,
  UpdateAgentSessionMessageDiagnosisSchema,
  UpdateAgentSessionMessageSchema
} from '@shared/data/api/schemas/agentSessionMessages'
import type { HandlersFor } from '@shared/data/api/types'

function sanitizeAssistantMessageForRenderer(message: AgentSessionMessageEntity): AgentSessionMessageEntity {
  if (message.role !== 'assistant' || !message.data.parts) return message

  return {
    ...message,
    data: {
      ...message.data,
      parts: message.data.parts.map((part) => projectAgentMessagePartForRenderer(part, message.id))
    }
  }
}

function getToolResult(message: AgentSessionMessageEntity, toolCallId: string): AgentSessionToolResultResponse {
  for (const part of message.data.parts ?? []) {
    const source = part as unknown as Record<string, unknown>
    if (source.toolCallId !== toolCallId) continue

    let result: AgentSessionToolResult | undefined
    if (source.state === 'output-error') {
      result = { kind: 'error', value: typeof source.errorText === 'string' ? source.errorText : '' }
    } else if ('output' in source) {
      result = { kind: 'output', value: source.output }
    }
    if (result) return { found: true, result }
  }

  return { found: false }
}

export const agentSessionMessageHandlers: HandlersFor<AgentSessionMessageSchemas> = {
  '/agent-sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const parsed = AgentSessionMessagesListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const response = agentSessionMessageService.listSessionMessages(params.sessionId, parsed.data)
      return {
        ...response,
        items: response.items.map(sanitizeAssistantMessageForRenderer)
      }
    }
  },

  '/agent-sessions/:sessionId/messages/:messageId': {
    GET: async ({ params }) => {
      return sanitizeAssistantMessageForRenderer(
        agentSessionMessageService.getSessionMessage(params.sessionId, params.messageId)
      )
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAgentSessionMessageSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      const message = agentSessionMessageService.updateSessionMessage(params.sessionId, params.messageId, parsed.data)
      return sanitizeAssistantMessageForRenderer(message)
    },

    DELETE: async ({ params }) => {
      agentSessionMessageService.deleteSessionMessage(params.sessionId, params.messageId)
      return undefined
    }
  },

  '/agent-sessions/:sessionId/messages/:messageId/tool-results/:toolCallId': {
    GET: async ({ params }) => {
      const message = agentSessionMessageService.getSessionMessage(params.sessionId, params.messageId)
      return getToolResult(message, params.toolCallId)
    }
  },

  '/agent-sessions/:sessionId/messages/:messageId/parts/:partIndex/diagnosis': {
    PATCH: async ({ params, body }) => {
      const partIndex = Number(params.partIndex)
      if (!Number.isInteger(partIndex) || partIndex < 0) {
        throw DataApiErrorFactory.validation({ partIndex: ['Part index must be a non-negative integer'] })
      }
      const parsed = UpdateAgentSessionMessageDiagnosisSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)

      agentSessionMessageService.updateSessionMessagePartDiagnosis(
        params.sessionId,
        params.messageId,
        partIndex,
        parsed.data.diagnosis
      )
      return undefined
    }
  }
}
