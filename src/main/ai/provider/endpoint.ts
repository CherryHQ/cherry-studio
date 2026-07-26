/**
 * Endpoint + AI SDK provider id resolution. See
 * `docs/references/ai/adapter-family.md` for design rationale.
 */

import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import {
  type AppProviderId,
  appProviderIds,
  type ConcreteProviderId,
  type KnownAppProviderId,
  type ProviderOptionsKey
} from '../types'
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

/** The namespaces the bundled SDK packages actually read. Closed: a namespace no
 *  package reads is a body delivered nowhere. */
type SdkOptionsNamespace = 'openai' | 'anthropic' | 'google' | 'vertex' | 'bytedance' | 'cherryin' | 'xai'

/**
 * Provider ids whose model reads a namespace that is NOT the id — shared SDK packages
 * (`openai`/`anthropic`/`xai` variants) or packages that hardcode their own name.
 * Absent ids read their own name.
 */
const PROVIDER_OPTIONS_KEYS = {
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
} as const satisfies Partial<Record<KnownAppProviderId, SdkOptionsNamespace>>

/** Aggregators that front several upstream families; the namespace follows the endpoint. */
const GATEWAY_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'cherryin',
  'cherryin-chat',
  'newapi',
  'aihubmix',
  SystemProviderIds.gateway
])

/**
 * The single source for "which `providerOptions` namespace does this model read".
 * Pass `concreteProviderId` for the openai-compatible family and `endpointType` for
 * the aggregators — both namespaces are dynamic, not a static property of the id.
 */
export function resolveProviderOptionsKey(
  providerId: AppProviderId,
  concreteProviderId?: ConcreteProviderId,
  endpointType?: EndpointType
): ProviderOptionsKey {
  // The sole construction point for the brand.
  const brand = (key: string) => key as ProviderOptionsKey

  if (endpointType && GATEWAY_PROVIDER_IDS.has(providerId)) {
    if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) return brand('anthropic')
    if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return brand('google')
    if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) return brand('openai')
  }
  if (providerId === 'openai-compatible' && concreteProviderId) {
    // Cannot be static: `createOpenAICompatible({ name })` reads `providerOptions[name]`.
    return brand(concreteProviderId)
  }
  return brand(PROVIDER_OPTIONS_KEYS[providerId as KnownAppProviderId] ?? providerId)
}
