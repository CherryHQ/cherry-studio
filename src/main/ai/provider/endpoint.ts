/**
 * Endpoint + AI SDK provider id resolution. See
 * `docs/references/ai/adapter-family.md` for design rationale.
 */

import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { type AppProviderId, appProviderIds } from '../types'
import { getBaseUrl } from '../utils/provider'

export interface ResolvedEndpoint {
  /** `undefined` when neither model nor provider declares an endpoint. */
  endpointType: EndpointType | undefined
  /** Empty string when no config matched. */
  baseUrl: string
}

/**
 * Priority: `model.endpointTypes[0]` → `provider.defaultChatEndpoint` → `undefined`.
 * `getBaseUrl` applies its own fallback among `endpointConfigs`.
 */
export function resolveEffectiveEndpoint(provider: Provider, model: Model): ResolvedEndpoint {
  const modelEndpoint = model.endpointTypes?.[0]
  const providerDefault = provider.defaultChatEndpoint
  const endpointType = modelEndpoint ?? providerDefault
  return { endpointType, baseUrl: getBaseUrl(provider, endpointType) }
}

/** Maps base id → variant id (`openai` + `openai-chat-completions` → `openai-chat`). No-op when no variant exists. */
export function resolveProviderVariant(
  baseProviderId: AppProviderId,
  endpointType: EndpointType | undefined
): AppProviderId {
  if (!endpointType) return baseProviderId

  if (endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || endpointType === ENDPOINT_TYPE.OLLAMA_CHAT) {
    const chatVariant = `${baseProviderId}-chat`
    if (chatVariant in appProviderIds) return appProviderIds[chatVariant]
  }

  if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
    const responsesVariant = `${baseProviderId}-responses`
    if (responsesVariant in appProviderIds) return appProviderIds[responsesVariant]
  }

  return baseProviderId
}

export function resolveAiSdkProviderId(provider: Provider, endpointType: EndpointType | undefined): AppProviderId {
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  if (adapterFamily && adapterFamily in appProviderIds) {
    return resolveProviderVariant(appProviderIds[adapterFamily], endpointType)
  }
  return appProviderIds['openai-compatible']
}

/**
 * Runtime provider ids whose AI SDK model reads a `providerOptions` namespace
 * that is NOT the id itself — either because several of our ids share one SDK
 * package (the `openai` / `anthropic` / `xai` variants), or because the package
 * hardcodes its own name (`@ai-sdk/google-vertex` → `vertex`,
 * `@ai-sdk/bytedance` → `bytedance`, `@cherrystudio/ai-sdk-provider` →
 * `cherryin`). Ids absent from this table read their own name.
 */
const PROVIDER_OPTIONS_KEYS: Partial<Record<AppProviderId, string>> = {
  'openai-chat': 'openai',
  azure: 'openai',
  'azure-responses': 'openai',
  huggingface: 'openai',
  'azure-anthropic': 'anthropic',
  'google-vertex': 'vertex',
  'google-vertex-anthropic': 'vertex',
  'google-vertex-maas': 'vertex',
  'xai-responses': 'xai',
  // The provider resolver upgrades cherryin's chat endpoint to the `-chat` variant, but
  // its models are `cherryin.<kind>` — `OpenAICompatibleChatLanguageModel` splits on `.`,
  // so both chat and image read `providerOptions.cherryin`.
  'cherryin-chat': 'cherryin',
  // `doubao` is only ever the runtime id of the image adapter (chat/embedding stay
  // openai-compatible), and that adapter is `@ai-sdk/bytedance`.
  doubao: 'bytedance'
}

/** Aggregators that front several upstream families; the namespace follows the endpoint. */
const GATEWAY_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'cherryin',
  'cherryin-chat',
  'newapi',
  'aihubmix',
  SystemProviderIds.gateway
])

/**
 * Maps the registered runtime provider id to the namespace its AI SDK model
 * reads from `providerOptions` — the single source for that fact, consumed by
 * the chat options builders, the image wire engine, and `sdkConfig.optionsKey`.
 *
 * Two namespaces are not a static property of the id:
 * - the `openai-compatible` family is dynamic — `createOpenAICompatible({ name })`
 *   names its models `${name}.<kind>` and reads `providerOptions[name]`, where
 *   `name` is the concrete provider id (`buildOpenAICompatibleConfig` sets
 *   `providerSettings.name = provider.id`), so pass `concreteProviderId` whenever
 *   it is known or the bag is delivered under a key no model reads (#17394);
 * - the aggregators route to an upstream family per endpoint, so pass
 *   `endpointType` when it is known.
 */
export function resolveProviderOptionsKey(
  providerId: AppProviderId,
  concreteProviderId?: string,
  endpointType?: EndpointType
): string {
  if (endpointType && GATEWAY_PROVIDER_IDS.has(providerId)) {
    if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) return 'anthropic'
    if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return 'google'
    if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) return 'openai'
  }
  if (providerId === 'openai-compatible' && concreteProviderId) {
    return concreteProviderId
  }
  return PROVIDER_OPTIONS_KEYS[providerId] ?? providerId
}
