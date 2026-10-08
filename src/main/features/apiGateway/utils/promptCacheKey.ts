/**
 * Stable per-session `prompt_cache_key` for internal Agent requests.
 *
 * The key only stabilizes OpenAI's cache routing — hits still require exact
 * prefix matches — but GPT-5.6+ model families need it for the reliable
 * matching path (https://developers.openai.com/api/docs/guides/prompt-caching).
 * Agent sessions resend a large stable prefix on every call, so the gateway
 * derives an opaque key from the validated Agent session id — same session,
 * same key — without letting the raw session id leave the process.
 */
import type { ProviderOptions } from '@ai-sdk/provider-utils'

import { resolveEffectiveEndpoint, resolveEndpointProviderOptionsKey } from '@main/ai/provider/endpoint'
import { deriveAgentSessionRoutingKey, usesOpenRouterSessionRouting } from '@main/ai/utils/agentSessionRouting'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/**
 * Merge a session-derived routing key into the providerOptions namespace the
 * resolved adapter reads. OpenAI Responses consumes `promptCacheKey`, while
 * OpenRouter Chat forwards `session_id` verbatim to its request body.
 */
export function applyAgentPromptCacheKey(
  provider: Provider,
  model: Model,
  providerOptions: ProviderOptions,
  agentSessionId: string
): ProviderOptions {
  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const optionName =
    resolvedEndpoint.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES
      ? 'promptCacheKey'
      : resolvedEndpoint.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS &&
          usesOpenRouterSessionRouting(provider, resolvedEndpoint.endpointType)
        ? 'session_id'
        : undefined
  if (!optionName) return providerOptions

  const providerOptionsKey = resolveEndpointProviderOptionsKey(provider, resolvedEndpoint)
  const namespace = providerOptions[providerOptionsKey]
  if (namespace?.[optionName] !== undefined) return providerOptions

  return {
    ...providerOptions,
    [providerOptionsKey]: { ...namespace, [optionName]: deriveAgentSessionRoutingKey(agentSessionId) }
  }
}
