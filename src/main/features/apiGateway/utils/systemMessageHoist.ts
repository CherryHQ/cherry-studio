/**
 * The Claude Agent SDK emits harness updates (agent/skill catalogs, deferred-tool
 * notices, "MCP servers are still connecting") as `role: 'system'` messages inside
 * `messages`, and `AnthropicMessageConverter` keeps them where the client put them.
 * That position is what makes the prompt prefix stable: a new update appends at the
 * tail, so everything before it still hits the provider's prefix cache.
 *
 * `@ai-sdk/google` is the only target that cannot take them in place — it throws
 * `system messages are only supported at the beginning of the conversation` once a
 * user turn has been seen. `@ai-sdk/anthropic` emits a `role: 'system'` message and
 * adds the `mid-conversation-system-2026-04-07` beta itself; `@ai-sdk/openai-compatible`
 * passes it straight through. So fold for Gemini only, and pay the prefix churn there.
 */
import type { CherryUIMessage } from '@shared/data/types/message'

const systemText = (message: CherryUIMessage): string =>
  message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .filter(Boolean)
    .join('\n\n')

/**
 * Merge every `role: 'system'` message into one leading message, preserving order.
 * Returns the input unchanged when at most a leading system message is present.
 */
export function hoistSystemMessages(messages: CherryUIMessage[]): CherryUIMessage[] {
  const firstNonSystem = messages.findIndex((message) => message.role !== 'system')
  if (firstNonSystem === -1) return messages
  if (!messages.slice(firstNonSystem).some((message) => message.role === 'system')) return messages

  const system = messages.filter((message) => message.role === 'system')
  const rest = messages.filter((message) => message.role !== 'system')
  const text = system.map(systemText).filter(Boolean).join('\n\n')
  if (!text) return rest

  return [{ ...system[0], role: 'system', parts: [{ type: 'text', text }] }, ...rest]
}
