/**
 * Claude Code's standard Agent loop requests another sample only when it has
 * new user semantics to provide. Gateway conversion can remove an empty user
 * shell and expose a text/reasoning assistant tail, so authenticated internal Agent
 * requests restore that user semantic explicitly before provider serialization.
 */
import { isToolUIPart } from 'ai'

import type { CherryUIMessage } from '@shared/data/types/message'

/** Request-only continuation for internal Agent requests. Never persisted. */
export const AGENT_CONTINUATION_TEXT =
  'Continue with the original user request above. The preceding assistant message is context, not a reply to complete.'

/**
 * Append a request-only user continuation after a final assistant attachment with
 * empty parts, or only text, reasoning, and settled local tools ending in text or
 * reasoning. Settled local tools are not provider-executed and have output-error,
 * output-denied, or non-preliminary output-available state. A settled local tool
 * may precede the final text/reasoning part; attachments ending in a tool or
 * containing any unsupported part return the input unchanged.
 */
export function appendInternalAgentContinuation(messages: CherryUIMessage[]): CherryUIMessage[] {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return messages
  if (
    !last.parts.every(
      (part) =>
        part.type === 'text' ||
        part.type === 'reasoning' ||
        (isToolUIPart(part) &&
          part.providerExecuted !== true &&
          (part.state === 'output-error' ||
            part.state === 'output-denied' ||
            (part.state === 'output-available' && part.preliminary !== true)))
    )
  )
    return messages
  const lastPart = last.parts.at(-1)
  if (lastPart && lastPart.type !== 'text' && lastPart.type !== 'reasoning') return messages

  return [
    ...messages,
    {
      id: 'no-prefill-continuation',
      role: 'user',
      parts: [{ type: 'text', text: AGENT_CONTINUATION_TEXT }]
    }
  ]
}
