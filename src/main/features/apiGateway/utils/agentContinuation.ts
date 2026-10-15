/**
 * Gateway conversion can drop an empty user shell after assistant text or reasoning.
 * Internal Agent requests restore that user semantic before provider serialization.
 */
import type { CherryUIMessage } from '@shared/data/types/message'

/** Request-only continuation for internal Agent requests. Never persisted. */
export const AGENT_CONTINUATION_TEXT =
  'Continue with the original user request above. The preceding assistant message is context, not a reply to complete.'

/**
 * Append a minimal user continuation after an assistant containing only text
 * and/or reasoning; otherwise return the input unchanged.
 */
export function appendInternalAgentContinuation(messages: CherryUIMessage[]): CherryUIMessage[] {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return messages
  if (!last.parts.every((part) => part.type === 'text' || part.type === 'reasoning')) return messages

  return [
    ...messages,
    {
      id: 'no-prefill-continuation',
      role: 'user',
      parts: [{ type: 'text', text: AGENT_CONTINUATION_TEXT }]
    }
  ]
}
