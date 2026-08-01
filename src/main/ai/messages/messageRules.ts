/**
 * `UIMessage[]` → provider-ready `ModelMessage[]` for `Agent.stream`, plus its steps.
 *
 * Kept as one exported pipeline (`toModelMessages`) so the whole chain is testable
 * end-to-end. Each step is pure and preserves element references when it changes nothing.
 */

import { convertToModelMessages, type ModelMessage, type ToolSet, type UIMessage } from 'ai'

import { ALL_MEDIA, type MediaCapabilities, stripUnsupportedMedia } from './messageCapabilities'

/** A string/array `content` → a flat parts array (`[]` for an empty string). */
function contentToParts(content: unknown): unknown[] {
  if (typeof content === 'string') return content.length > 0 ? [{ type: 'text', text: content }] : []
  return Array.isArray(content) ? content : []
}

/**
 * Merge adjacent same-role messages into one (concatenate content). Cleans up the
 * adjacency left when `convertToModelMessages` drops an empty turn.
 *
 * A normalization, not a validation — never throws, never merges across roles (so
 * assistant↔tool stays intact). `@ai-sdk/anthropic` merges same-role anyway (so this
 * is idempotent there); `@ai-sdk/google` does not (so this is what makes it safe).
 */
export function coalesceConsecutiveSameRole(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const message of messages) {
    const prev = out.at(-1)
    if (!prev || prev.role !== message.role) {
      out.push(message)
      continue
    }
    if (prev.role === 'system') {
      out[out.length - 1] = { ...prev, content: `${prev.content}\n\n${(message as typeof prev).content}` }
      continue
    }
    out[out.length - 1] = {
      ...prev,
      content: [
        ...contentToParts((prev as { content: unknown }).content),
        ...contentToParts((message as { content: unknown }).content)
      ]
    } as ModelMessage
  }
  return out
}

/**
 * Replace an assistant message that converted to empty content with a placeholder.
 *
 * `convertToModelMessages` emits `{ role: 'assistant', content: [] }` for a turn whose
 * only parts don't convert to model content (e.g. a persisted `data-error`), which
 * Gemini rejects (HTTP 400). Observing the converted shape covers every non-content
 * part type (`data-*`, `source-*`, …) without predicting the SDK's conversion. See #16195.
 */
export function ensureNonEmptyAssistantContent(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === 'assistant' && Array.isArray(m.content) && m.content.length === 0
      ? { ...m, content: [{ type: 'text', text: '...' }] }
      : m
  )
}

/**
 * Drop persisted `reasoning` parts (prior chain-of-thought) from the history before
 * conversion. Providers never need another turn's draft reasoning to answer, so this
 * saves a large amount of input tokens on long conversations.
 *
 * Only safe for providers that do NOT require reasoning to be round-tripped — callers
 * must not enable this for Anthropic (signed thinking blocks) or Gemini (thought
 * signatures). Returns the input unchanged when nothing was stripped, and never
 * mutates the shared history (parts arrays are rebuilt only where filtered).
 */
export function stripHistoryReasoning(messages: UIMessage[]): UIMessage[] {
  let changed = false
  const out = messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.parts)) return message
    const parts = message.parts.filter((part) => part.type !== 'reasoning')
    if (parts.length === message.parts.length) return message
    changed = true
    return { ...message, parts }
  })
  return changed ? out : messages
}

/**
 * The message-shaping pipeline `Agent.stream` runs on its conversion input
 * (`originalMessages` stays un-shaped upstream, so none of this leaks to the UI):
 *
 * strip media the model can't accept → optionally strip historical reasoning →
 * convert, dropping incomplete tool calls that would otherwise dangle without a
 * result → merge adjacent same-role turns left by drops → placeholder any turn that
 * still converted to empty content. See #16195.
 */
export async function toModelMessages(
  messages: UIMessage[],
  caps?: MediaCapabilities,
  tools?: ToolSet,
  options?: { stripReasoning?: boolean }
): Promise<ModelMessage[]> {
  const shaped = stripUnsupportedMedia(messages, caps ?? ALL_MEDIA)
  const pruned = options?.stripReasoning ? stripHistoryReasoning(shaped) : shaped
  const model = await convertToModelMessages(pruned, { ignoreIncompleteToolCalls: true, tools })
  return ensureNonEmptyAssistantContent(coalesceConsecutiveSameRole(model))
}
