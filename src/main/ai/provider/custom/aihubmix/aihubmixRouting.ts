/**
 * AiHubMix per-model routing — single source of truth.
 *
 * AiHubMix is a multi-backend gateway: one registered provider that dispatches a chat model to one
 * of four AI SDK model classes by its raw API id prefix. This module owns that dispatch rule so both
 * consumers derive from the same function and can never drift:
 *   - the runtime factory (`createChatModel` in `aihubmixProvider.ts`) picks the model class, and
 *   - request-time endpoint resolution (`resolveGatewayEndpointType` → `resolveEffectiveEndpoint`)
 *     picks the wire endpoint, which drives the reasoning-options namespace/dialect + feature gates.
 *
 * Surfacing the endpoint at request time (not persisted on the model row) is deliberate: AiHubMix's
 * `/models` list carries no `supported_endpoint_types`, and user-added ids never pass through it, so
 * the rule must run off the model id itself.
 */
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

/** Wire family AiHubMix routes a chat model to, by raw API model id. */
export type AihubmixChatFamily = 'anthropic' | 'gemini' | 'openai-responses' | 'openai-chat' | 'compat'

// AiHubMix dispatches on raw API model ids. Keep these predicates string-based: the shared
// `@shared/utils/model` helpers resolve the raw id via getRawModelId → parseUniqueModelId, which
// THROWS ('Invalid UniqueModelId format') on a bare API id with no `::`. A fabricated
// `{ id: modelId } as Model` would therefore CRASH on every OpenAI-routed model here — it doesn't
// merely lack metadata. (The chat-completion-only list below has no shared string source, so it
// stays local too.)
const isOpenAILLM = (modelId: string): boolean => {
  const id = modelId.toLowerCase()
  return /\bgpt\b|^o[134]/.test(id) && !id.includes('gpt-4o-image')
}

const isOpenAIChatCompletionOnly = (modelId: string): boolean => {
  const id = modelId.toLowerCase()
  return (
    id.includes('gpt-4o-search-preview') ||
    id.includes('gpt-4o-mini-search-preview') ||
    id.includes('o1-mini') ||
    id.includes('o1-preview')
  )
}

/** The wire family for a model id. Mirrors the `createChatModel` dispatch tree exactly. */
export function resolveAihubmixChatFamily(modelId: string): AihubmixChatFamily {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (
    (modelId.startsWith('gemini') || modelId.startsWith('imagen')) &&
    !modelId.endsWith('no-think') &&
    !modelId.endsWith('-search') &&
    !modelId.includes('embedding')
  ) {
    return 'gemini'
  }
  if (isOpenAILLM(modelId)) {
    return isOpenAIChatCompletionOnly(modelId) ? 'openai-chat' : 'openai-responses'
  }
  return 'compat'
}

const FAMILY_ENDPOINT: Record<AihubmixChatFamily, EndpointType> = {
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'openai-responses': ENDPOINT_TYPE.OPENAI_RESPONSES,
  'openai-chat': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  compat: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

/**
 * Wire endpoint AiHubMix serves a model on. Consumed by `resolveEffectiveEndpoint` (via
 * `gatewayRouting`) when the model carries no explicit `endpointTypes`. Every returned endpoint is
 * declared in the AiHubMix catalog with `adapterFamily: 'aihubmix'`, so `aiSdkProviderId` stays
 * `aihubmix` and the runtime builder selection + reasoning namespace both resolve correctly.
 */
export function resolveAihubmixEndpointType(modelId: string): EndpointType {
  return FAMILY_ENDPOINT[resolveAihubmixChatFamily(modelId)]
}

const FAMILY_PROVIDER_OPTIONS_KEY: Record<AihubmixChatFamily, string> = {
  anthropic: 'anthropic',
  gemini: 'google',
  'openai-responses': 'openai',
  // @ai-sdk/openai's chat model reads the canonical `openai` namespace.
  'openai-chat': 'openai',
  // @ai-sdk/openai-compatible derives this from the `aihubmix.chat` provider string.
  compat: 'aihubmix'
}

export interface AihubmixChatRoute {
  endpointType: EndpointType
  providerOptionsKey: string
}

export function resolveAihubmixChatRoute(modelId: string): AihubmixChatRoute {
  const family = resolveAihubmixChatFamily(modelId)
  return {
    endpointType: FAMILY_ENDPOINT[family],
    providerOptionsKey: FAMILY_PROVIDER_OPTIONS_KEY[family]
  }
}
