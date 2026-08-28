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
import { createHash } from 'node:crypto'

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { resolveEffectiveEndpoint, resolveEndpointProviderOptionsKey } from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/**
 * Merge a session-derived `promptCacheKey` into the providerOptions namespace
 * the resolved adapter reads (the same resolution chain reasoning options use).
 * No-op for non-Responses endpoints; never overrides an existing key and keeps
 * the namespace's other options intact.
 */
export function applyAgentPromptCacheKey(
  provider: Provider,
  model: Model,
  providerOptions: ProviderOptions,
  agentSessionId: string
): ProviderOptions {
  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  if (resolvedEndpoint.endpointType !== ENDPOINT_TYPE.OPENAI_RESPONSES) return providerOptions

  const providerOptionsKey = resolveEndpointProviderOptionsKey(provider, resolvedEndpoint)
  const namespace = providerOptions[providerOptionsKey]
  if (namespace?.promptCacheKey !== undefined) return providerOptions

  const digest = createHash('sha256').update(agentSessionId).digest('hex')
  return {
    ...providerOptions,
    [providerOptionsKey]: { ...namespace, promptCacheKey: `cherry-agent:${digest.slice(0, 32)}` }
  }
}
