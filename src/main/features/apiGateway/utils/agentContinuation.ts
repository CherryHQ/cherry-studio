/**
 * Claude Code's standard Agent loop requests another sample only when it has
 * new user semantics to provide. Gateway conversion can remove an empty user
 * shell and expose a text/reasoning assistant tail, so authenticated internal Agent
 * requests restore that user semantic explicitly before provider serialization.
 */
import type { CherryUIMessage } from '@shared/data/types/message'

/** Request-only continuation for internal Agent requests. Never persisted. */
export const AGENT_CONTINUATION_TEXT =
  'Continue with the original user request above. The preceding assistant message is context, not a reply to complete.'

/**
 * If the converted list ends with an assistant whose parts are all text or
 * reasoning (including reasoning-only), return a copy with a minimal user
 * continuation. Tool or other part types return the input unchanged.
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
