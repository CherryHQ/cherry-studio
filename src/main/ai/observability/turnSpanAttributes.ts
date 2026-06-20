import { loggerService } from '@logger'
import type { Span } from '@opentelemetry/api'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { KB } from '@shared/utils/constants'
import type { UIMessage } from 'ai'

import type { CherryUIMessage } from '../streamManager/types'

const logger = loggerService.withContext('turnSpanAttributes')

/**
 * Turn-level attributes for the `ai.turn` root span (OTel GenAI conventions).
 *
 * `ai.turn` wraps a whole user turn (one ask → N model calls + tools → final
 * answer), so it's the only span that owns the *turn boundary*: the triggering
 * user prompt and the final assistant answer. Child `chat`/`doStream` spans only
 * own per-call slices. We set identity + the boundary content here; token usage
 * is deliberately NOT set (that's the durable `message.stats`' job).
 *
 * Both helpers are best-effort — a malformed message must never break streaming.
 */

/** Cap for captured prompt/answer text — debug content, gated on the dev-only trace store. */
const MAX_CONTENT_CHARS = 8 * KB

export interface TurnInputInfo {
  modelId: UniqueModelId
  topicId: string
  /** `chat` for a plain turn, `invoke_agent` when the turn drives an agent session. */
  operation: 'chat' | 'invoke_agent'
  messages?: UIMessage[]
  /** Agent display name (agent sessions only) → `gen_ai.agent.name`. */
  agentName?: string
}

export function applyTurnInputAttributes(span: Span, info: TurnInputInfo): void {
  try {
    span.setAttribute('gen_ai.operation.name', info.operation)
    span.setAttribute('gen_ai.conversation.id', info.topicId)
    if (info.agentName) span.setAttribute('gen_ai.agent.name', info.agentName)
    const prompt = lastUserText(info.messages)
    if (prompt) span.setAttribute('inputs', truncate(prompt, MAX_CONTENT_CHARS))
    // Parse model id AFTER unconditional attributes — a malformed model id
    // must not wipe the attributes already set.
    const { providerId, modelId } = parseUniqueModelId(info.modelId)
    if (providerId) span.setAttribute('gen_ai.provider.name', providerId)
    if (modelId) span.setAttribute('gen_ai.request.model', modelId)
  } catch (error) {
    logger.warn('applyTurnInputAttributes failed', { error })
  }
}

export function applyTurnOutputAttributes(span: Span, finalMessage: CherryUIMessage): void {
  try {
    const text = partsText(finalMessage.parts)
    if (text) span.setAttribute('outputs', truncate(text, MAX_CONTENT_CHARS))
    const toolCalls = countToolParts(finalMessage.parts)
    if (toolCalls > 0) span.setAttribute('cs.tool_calls', toolCalls)
  } catch (error) {
    logger.warn('applyTurnOutputAttributes failed', { error })
  }
}

/** Text of the last user message that has text content — the prompt that triggered the turn.
 *  (A trailing user message with no text parts, e.g. tool-result-only, is skipped.) */
function lastUserText(messages: UIMessage[] | undefined): string | undefined {
  if (!messages?.length) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const text = partsText(messages[i].parts)
    if (text) return text
  }
  return undefined
}

function partsText(parts: ReadonlyArray<{ type?: string; text?: string }> | undefined): string {
  if (!parts) return ''
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

function countToolParts(parts: ReadonlyArray<{ type?: string }> | undefined): number {
  if (!parts) return 0
  // Same shape the persistence layer treats as a tool part.
  return parts.filter((part) => {
    const type = part?.type
    return typeof type === 'string' && (type.startsWith('tool-') || type === 'dynamic-tool')
  }).length
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…[truncated ${str.length - max} chars]` : str
}
