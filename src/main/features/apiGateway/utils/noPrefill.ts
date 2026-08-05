/**
 * TODO(no-prefill-workaround): delete this module (and its proxyStream wiring)
 * once the Agent SDK stops materializing context attachments as a trailing
 * assistant message. The behavior lives in the closed-source CLI binary, so
 * there is no upstream PR to track — watch the claude-agent-sdk release notes /
 * claude-code CHANGELOG for a prefill fix. Closest upstream report (different
 * trigger path, closed as stale): https://github.com/anthropics/claude-code/issues/52433
 */
import type { CherryUIMessage } from '@shared/data/types/message'

/** Request-only continuation appended for no-prefill models. Never persisted. */
export const NO_PREFILL_CONTINUATION_TEXT =
  'Continue with the original user request above. The preceding assistant message is context, not a reply to complete.'

/**
 * If the converted list ends with a text-only assistant message, return a copy
 * with a minimal user continuation; otherwise return the input unchanged.
 */
export function appendNoPrefillContinuation(messages: CherryUIMessage[]): CherryUIMessage[] {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return messages
  if (!last.parts.every((part) => part.type === 'text')) return messages

  return [
    ...messages,
    {
      id: 'no-prefill-continuation',
      role: 'user',
      parts: [{ type: 'text', text: NO_PREFILL_CONTINUATION_TEXT }]
    }
  ]
}
