import type { Provider } from '@shared/data/types/provider'
import { matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { OPENROUTER_CONVERSATION_HEADER } from '../provider/config'

/**
 * The conversation-keyed headers a host reads, for runtimes that talk to the provider directly.
 *
 * The chat pipeline gets this from `ProviderConfig.conversationHeader` (filled from
 * `request.conversation.id`), but an agent runtime spawns its own client and never builds one — so
 * the same declaration is applied here, keyed on the agent session. Runtimes routed through Cherry's
 * local Gateway must NOT use this: the Gateway is the chat pipeline and fills the header itself.
 */
export function agentConversationHeaders(provider: Provider, sessionId: string): Record<string, string> {
  return matchesPreset(provider, SystemProviderIds.openrouter) ? { [OPENROUTER_CONVERSATION_HEADER]: sessionId } : {}
}

/**
 * Overlay explicitly configured headers on defaults, matching names case-insensitively so a
 * configured `X-Session-Id` REPLACES a default `x-session-id` instead of riding alongside it —
 * HTTP header names are case-insensitive, and emitting both leaves the winner to the transport.
 * Configured names keep their own casing.
 */
export function withDefaultAgentProviderHeaders(
  defaults: Record<string, string>,
  configured: Record<string, string> | undefined
): Record<string, string> {
  const merged = new Map<string, [name: string, value: string]>()
  for (const [name, value] of Object.entries(defaults)) merged.set(name.toLowerCase(), [name, value])
  for (const [name, value] of Object.entries(configured ?? {})) merged.set(name.toLowerCase(), [name, value])
  return Object.fromEntries([...merged.values()])
}

/**
 * Cherry's `extraHeaders` are user-editable and can still hold non-string values (v1 settings
 * passthrough, API writes): coerce them to the `Record<string, string>` every agent runtime
 * requires — pi throws inside its config resolver, dsh fails its route schema.
 */
export function toAgentProviderHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const coerced: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers) as [string, unknown][]) {
    if (value == null || typeof value === 'object') continue
    coerced[name] = String(value)
  }
  return coerced
}
