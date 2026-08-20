/**
 * The Claude Agent SDK emits harness updates (agent/skill catalogs, deferred-tool
 * notices, "MCP servers are still connecting") as `role: 'system'` messages inside
 * `messages`, and `AnthropicMessageConverter` keeps them where the client put them.
 * That position is what makes the prompt prefix stable: a new update appends at the
 * tail, so everything before it still hits the provider's prefix cache.
 *
 * Not every target accepts that shape, so `SYSTEM_IN_PLACE_ENDPOINTS` allowlists the
 * ones whose AI SDK converter was verified to emit a non-leading system message rather
 * than throw.
 *
 * For the rest there are two outcomes. A client that negotiated
 * `mid-conversation-system-2026-04-07` gets a 400 naming the beta and downgrades itself
 * to `<system-reminder>` blocks inside user turns — which keeps *its* prefix stable, so
 * nothing is lost. A client that did not negotiate it has no downgrade path, so its
 * messages are folded instead: correct output, at the cost of the prefix cache.
 */
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

/**
 * Verified against the installed SDKs:
 * - `@ai-sdk/anthropic` 3.0.103 pushes `{ role: 'system' }` and adds the
 *   `mid-conversation-system-2026-04-07` beta itself (`dist/index.mjs:2380`)
 * - `@ai-sdk/openai` 3.0.53 pushes it on both the chat and responses paths (`:114`, `:2761`)
 * - `@ai-sdk/openai-compatible` 2.0.62 pushes it (`:114`)
 * - `ollama-ai-provider-v2` 3.3.1 pushes it in `convertToOllamaChatMessages` (`:697`)
 *
 * Deliberately excluded: `@ai-sdk/google` throws `system messages are only supported at
 * the beginning of the conversation` (`:523`), and the `*-text-completions` /
 * `ollama-generate` converters throw `Unexpected system message in prompt`.
 */
const SYSTEM_IN_PLACE_ENDPOINTS: ReadonlySet<EndpointType> = new Set([
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.OLLAMA_CHAT
])

/** Whether `endpointType` keeps a non-leading system message in place instead of rejecting it. */
export function keepsSystemMessagesInPlace(endpointType: EndpointType | undefined): boolean {
  return endpointType !== undefined && SYSTEM_IN_PLACE_ENDPOINTS.has(endpointType)
}

const systemText = (message: CherryUIMessage): string =>
  message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .filter(Boolean)
    .join('\n\n')

/** Whether any `role: 'system'` message sits after the conversation has started. */
export function hasNonLeadingSystemMessage(messages: CherryUIMessage[]): boolean {
  const firstNonSystem = messages.findIndex((message) => message.role !== 'system')
  return firstNonSystem !== -1 && messages.slice(firstNonSystem).some((message) => message.role === 'system')
}

/**
 * Merge every `role: 'system'` message into one leading message, preserving order.
 * Returns the input unchanged when at most a leading system message is present.
 */
export function hoistSystemMessages(messages: CherryUIMessage[]): CherryUIMessage[] {
  if (!hasNonLeadingSystemMessage(messages)) return messages

  const system = messages.filter((message) => message.role === 'system')
  const rest = messages.filter((message) => message.role !== 'system')
  const text = system.map(systemText).filter(Boolean).join('\n\n')
  if (!text) return rest

  return [{ ...system[0], role: 'system', parts: [{ type: 'text', text }] }, ...rest]
}

/** The beta a client sets to declare it can send — and downgrade from — inline system messages. */
export const MID_CONVERSATION_SYSTEM_BETA = 'mid-conversation-system-2026-04-07'

function negotiatedMidConversationSystem(requestHeaders: Headers | undefined): boolean {
  const betas = requestHeaders?.get('anthropic-beta')
  return (
    betas !== null && betas !== undefined && betas.split(',').some((b) => b.trim() === MID_CONVERSATION_SYSTEM_BETA)
  )
}

/**
 * The Agent SDK retries without the beta when a 400's message names it, then sticky-disables
 * it for the session. Its matcher reads the message text, so the beta name and the literal
 * `anthropic-beta` must both survive into the error envelope verbatim.
 */
function midConversationSystemUnsupported(): Error & { status: number } {
  const error = new Error(
    `Unexpected role "system" in input message role list: ` +
      `anthropic-beta ${MID_CONVERSATION_SYSTEM_BETA} is not supported for this target model.`
  ) as Error & { status: number }
  error.status = 400
  return error
}

/**
 * Place inline system messages for the resolved target.
 *
 * @throws a 400 naming the beta when the client negotiated it, so it downgrades itself.
 */
export function positionInlineSystemMessages(
  messages: CherryUIMessage[],
  endpointType: EndpointType | undefined,
  requestHeaders: Headers | undefined
): CherryUIMessage[] {
  if (keepsSystemMessagesInPlace(endpointType)) return messages
  if (!hasNonLeadingSystemMessage(messages)) return messages
  if (negotiatedMidConversationSystem(requestHeaders)) throw midConversationSystemUnsupported()
  return hoistSystemMessages(messages)
}
