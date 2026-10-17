/**
 * Stable per-session `prompt_cache_key` for internal Agent requests.
 *
 * The key only stabilizes OpenAI's cache routing — hits still require exact
 * prefix matches — but GPT-5.6+ model families need it for the reliable
 * matching path (https://developers.openai.com/api/docs/guides/prompt-caching).
 * Agent sessions resend a large stable prefix on every call, so the gateway
 * derives an opaque key from the validated Agent session id — same session,
 * same key — without letting the raw session id leave the process.
 *
 * Sent on both OpenAI dialects, gated per dialect:
 * - Responses: `prompt_cache_key` is a documented param everywhere the adapter
 *   targets, so the session key always rides along.
 * - Chat completions: the field is unknown to many OpenAI-compatible servers
 *   and strict ones reject unknown body fields, so it is only sent to
 *   api.openai.com or hosts that declare the `promptCacheKey` dialect.
 */
import { createHash } from 'node:crypto'

import type { ProviderOptions } from '@ai-sdk/provider-utils'

import {
  resolveAiSdkProviderId,
  resolveEffectiveEndpoint,
  resolveEndpointProviderOptionsKey
} from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/** OpenAI bounds `prompt_cache_key` at 64 characters. */
const PROMPT_CACHE_KEY_MAX_LENGTH = 64

function clampPromptCacheKey(key: string): string {
  return key.length <= PROMPT_CACHE_KEY_MAX_LENGTH ? key : key.slice(0, PROMPT_CACHE_KEY_MAX_LENGTH)
}

/** An OpenAI host — `prompt_cache_key` is a first-class param there regardless of dialect flags. */
function isOpenAiHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === 'api.openai.com'
  } catch {
    return false
  }
}

/**
 * Merge a session-derived `promptCacheKey` into the providerOptions namespace
 * the resolved adapter reads (the same resolution chain reasoning options use).
 * No-op for non-OpenAI endpoints and for chat-completions hosts that have not
 * opted in; never overrides an existing key and keeps the namespace's other
 * options intact.
 */
export function applyAgentPromptCacheKey(
  provider: Provider,
  model: Model,
  providerOptions: ProviderOptions,
  agentSessionId: string
): ProviderOptions {
  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const endpointType = resolvedEndpoint.endpointType
  if (endpointType !== ENDPOINT_TYPE.OPENAI_RESPONSES && endpointType !== ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) {
    return providerOptions
  }

  if (
    endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS &&
    !isOpenAiHost(resolvedEndpoint.baseUrl) &&
    provider.endpointConfigs?.[endpointType]?.dialect?.promptCacheKey !== true
  ) {
    return providerOptions
  }

  const providerOptionsKey = resolveEndpointProviderOptionsKey(provider, resolvedEndpoint)
  const namespace = providerOptions[providerOptionsKey]
  const existing = namespace as Record<string, unknown> | undefined
  if (existing?.promptCacheKey !== undefined || existing?.prompt_cache_key !== undefined) return providerOptions

  const digest = createHash('sha256').update(agentSessionId).digest('hex')
  // @ai-sdk/openai maps `promptCacheKey` onto the wire field; the openai-compatible
  // adapter has no mapping and spreads unknown namespace keys onto the body verbatim,
  // so that dialect must carry the snake_case name itself.
  const wireField =
    resolveAiSdkProviderId(provider, endpointType) === 'openai-compatible' ? 'prompt_cache_key' : 'promptCacheKey'

  return {
    ...providerOptions,
    [providerOptionsKey]: {
      ...namespace,
      [wireField]: clampPromptCacheKey(`cherry-agent:${digest.slice(0, 32)}`)
    }
  }
}
