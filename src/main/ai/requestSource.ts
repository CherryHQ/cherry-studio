/**
 * Per-request provenance for upstream model calls.
 *
 * CherryIN relays traffic for several Cherry Studio features through one
 * endpoint and can't otherwise tell which feature — or which conversation — a
 * request came from. Two headers carry that, and they are attached ONLY when
 * BOTH hold (no other request ever sees them):
 *
 * - the request's provider is CherryIN, and
 * - the user has consented to anonymous data collection
 *   (`app.privacy.data_collection.enabled`).
 *
 * The headers themselves:
 *
 * - `X-Cherry-Source` — which feature originated the request.
 * - `X-Cherry-Conversation-Id` — the owning conversation, for the two features
 *   that have one (chat → topic id, agent → session id). Omitted otherwise.
 *
 * The server side must read these exact header names.
 */
import { SystemProviderIds } from '@shared/utils/systemProviderId'

export const CHERRY_SOURCE_HEADER = 'X-Cherry-Source'
export const CHERRY_CONVERSATION_ID_HEADER = 'X-Cherry-Conversation-Id'

/** Feature that originated an upstream model request. Value of `X-Cherry-Source`. */
export const CherryRequestSource = {
  Chat: 'chat',
  Agent: 'agent',
  Translate: 'translate',
  Knowledge: 'knowledge',
  Paint: 'paint'
} as const

export type CherryRequestSource = (typeof CherryRequestSource)[keyof typeof CherryRequestSource]

/**
 * Provenance attached to a request by its originating feature. Materialized
 * into the `X-Cherry-*` headers only when the resolved provider is CherryIN.
 */
export interface AiRequestSource {
  feature: CherryRequestSource
  /** Owning conversation id — set only for features that have one (chat → topic, agent → session). */
  conversationId?: string
}

/** Whether a provider id is CherryIN — the only provider that receives the provenance headers. */
export function isCherryinProviderId(providerId: string): boolean {
  return providerId === SystemProviderIds.cherryin
}

export function buildRequestSourceHeaders(source: AiRequestSource): Record<string, string> {
  return {
    [CHERRY_SOURCE_HEADER]: source.feature,
    ...(source.conversationId ? { [CHERRY_CONVERSATION_ID_HEADER]: source.conversationId } : {})
  }
}

/**
 * Serialize headers into the `ANTHROPIC_CUSTOM_HEADERS` env format the Claude
 * Agent SDK parses — one `Name: Value` per line. Used by the agent-session
 * runtime, which configures the subprocess via env rather than per-call headers.
 */
export function toAnthropicCustomHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}
