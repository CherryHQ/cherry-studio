/**
 * Reads the failed message a doctor analysis is bound to. Everything returned here is headed for a
 * model prompt, so it is redacted and treated as untrusted text.
 */

import { temporaryChatService } from '@data/services/TemporaryChatService'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { readConversation } from '@main/ai/messages/readConversation'
import { defangSystemReminderTags, sanitizeUntrustedText } from '@main/ai/untrustedContent'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { Message } from '@shared/data/types/message'
import type { DoctorAgentIncident } from '@shared/types/doctorAgent'

import { redactForModel } from './doctorWrites'

const BODY_LIMIT = 4 * 1024
const ATTEMPT_MESSAGE_LIMIT = 300
const ERROR_FIELDS = [
  'name',
  'message',
  'code',
  'statusCode',
  'statusText',
  'url',
  'isRetryable',
  'finishReason',
  'providerId',
  'modelId',
  'toolName',
  'reason',
  'cause'
] as const

export type IncidentMessage = Message | AgentSessionMessageEntity

export function truncateText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}… [${text.length - limit} more chars]` : text
}

/** Redacts secrets, then neutralizes prompt-boundary tricks in every string. */
export function untrustedForModel(value: unknown): unknown {
  const walk = (val: unknown): unknown => {
    if (typeof val === 'string') return defangSystemReminderTags(sanitizeUntrustedText(val))
    if (Array.isArray(val)) return val.map(walk)
    if (typeof val === 'object' && val !== null) {
      return Object.fromEntries(Object.entries(val).map(([key, item]) => [key, walk(item)]))
    }
    return val
  }
  return walk(redactForModel(value))
}

/** `readConversation` id: the topic id for chats, the bare session id for Agent sessions. */
export function conversationIdOf(topicId: string): string {
  return isAgentSessionTopic(topicId) ? extractAgentSessionId(topicId) : topicId
}

/** The incident message, or undefined once it was deleted. */
export function readIncidentMessage(incident: DoctorAgentIncident): IncidentMessage | undefined {
  const conversationId = conversationIdOf(incident.topicId)
  try {
    if (temporaryChatService.hasTopic(conversationId)) {
      return temporaryChatService.listMessages(conversationId).find((message) => message.id === incident.messageId)
    }
    const result = readConversation({ sessionId: conversationId, messageId: incident.messageId })
    return 'message' in result ? result.message : undefined
  } catch {
    return undefined
  }
}

function projectError(data: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const field of ERROR_FIELDS) {
    if (data[field] !== undefined && data[field] !== null) projected[field] = data[field]
  }
  if (typeof data.responseBody === 'string') projected.responseBody = truncateText(data.responseBody, BODY_LIMIT)
  if (Array.isArray(data.errors)) {
    projected.attempts = data.errors.map((attempt) => {
      const { statusCode, message } = (attempt ?? {}) as { statusCode?: unknown; message?: unknown }
      return {
        statusCode,
        message: typeof message === 'string' ? truncateText(message, ATTEMPT_MESSAGE_LIMIT) : undefined
      }
    })
  }
  return projected
}

/** Every `data-error` part of the message, projected for the model. */
export function incidentErrors(message: IncidentMessage): unknown[] {
  return (message.data.parts ?? []).flatMap((part) =>
    part.type === 'data-error' ? [untrustedForModel(projectError(part.data as Record<string, unknown>))] : []
  )
}
