/**
 * Endpoint + AI SDK provider id resolution. See
 * `docs/references/ai/adapter-family.md` for design rationale.
 */

import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

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
  // Older seeded OpenRouter rows may predate the image endpoint config. Provider identity is still
  // authoritative: every OpenRouter endpoint uses its native adapter, whose image model calls the
  // shared JSON `/images` route for both generation and input-reference editing.
  if (provider.id === 'openrouter' || provider.presetProviderId === 'openrouter') return appProviderIds.openrouter

  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  if (adapterFamily && adapterFamily in appProviderIds) {
    return resolveProviderVariant(appProviderIds[adapterFamily], endpointType)
  }
  return appProviderIds['openai-compatible']
}
