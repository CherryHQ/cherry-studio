/**
 * Clear-aware conversation / prompt-cache identity for normal chat.
 *
 * Providers that route prompt cache by a session or `prompt_cache_key` must not
 * keep matching a pre-clear conversation after the user starts a new context.
 * `conversation.id` is that identity: stable within a clear-context segment,
 * rotated when the latest clear-context boundary changes.
 *
 * OpenAI Responses (and the openai Chat Completions namespace) get
 * `promptCacheKey`. openai-compatible Chat Completions get `user` — the only
 * first-class identity field that package serializes onto the wire.
 */
import { createHash } from 'node:crypto'

import type { ProviderOptions } from '@ai-sdk/provider-utils'

import { resolveEffectiveEndpoint, resolveEndpointProviderOptionsKey } from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/** Topic-scoped id that rotates at each clear-context boundary. */
export function resolveClearAwareConversationId(
  topicId: string,
  clearBoundaryMessageId: string | null | undefined
): string {
  return clearBoundaryMessageId ? `${topicId}:${clearBoundaryMessageId}` : topicId
}

export function deriveChatPromptCacheKey(conversationId: string): string {
  const digest = createHash('sha256').update(conversationId).digest('hex')
  return `cherry-chat:${digest.slice(0, 32)}`
}

/**
 * Merge a conversation-derived cache/session identity into the providerOptions
 * namespace the resolved adapter reads. Never overrides an explicit key.
 */
export function applyChatPromptCacheIdentity(
  provider: Provider,
  model: Model,
  providerOptions: ProviderOptions,
  conversationId: string
): ProviderOptions {
  if (!conversationId) return providerOptions

  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const endpointType = resolvedEndpoint.endpointType
  if (endpointType !== ENDPOINT_TYPE.OPENAI_RESPONSES && endpointType !== ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) {
    return providerOptions
  }

  const providerOptionsKey = resolveEndpointProviderOptionsKey(provider, resolvedEndpoint)
  const namespace = providerOptions[providerOptionsKey]
  const cacheKey = deriveChatPromptCacheKey(conversationId)

  if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES || providerOptionsKey === 'openai') {
    if (namespace?.promptCacheKey !== undefined) return providerOptions
    return {
      ...providerOptions,
      [providerOptionsKey]: { ...namespace, promptCacheKey: cacheKey }
    }
  }

  if (namespace?.user !== undefined) return providerOptions
  return {
    ...providerOptions,
    [providerOptionsKey]: { ...namespace, user: cacheKey }
  }
}
