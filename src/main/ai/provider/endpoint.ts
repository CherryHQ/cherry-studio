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
import { resolveGatewayRoute } from './gatewayRouting'

export interface ResolvedEndpoint {
  /** `undefined` when neither model nor provider declares an endpoint. */
  endpointType: EndpointType | undefined
  /** Empty string when no config matched. */
  baseUrl: string
  /** Provider-options namespace selected by a multi-backend gateway route. */
  providerOptionsKey?: string
}

/**
 * Priority: `model.endpointTypes[0]` → gateway per-model route → `provider.defaultChatEndpoint` →
 * `undefined`. The gateway step resolves the wire endpoint from the model id for multi-backend
 * gateways (AiHubMix, …) whose models carry no explicit `endpointTypes` (see `gatewayRouting`).
 * `getBaseUrl` applies its own fallback among `endpointConfigs`.
 */
export function resolveEffectiveEndpoint(provider: Provider, model: Model): ResolvedEndpoint {
  const gatewayRoute = resolveGatewayRoute(provider, model)
  const endpointType = model.endpointTypes?.[0] ?? gatewayRoute?.endpointType ?? provider.defaultChatEndpoint
  const providerOptionsKey =
    gatewayRoute && endpointType === gatewayRoute.endpointType ? gatewayRoute.providerOptionsKey : undefined
  return { endpointType, baseUrl: getBaseUrl(provider, endpointType), providerOptionsKey }
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
 * Maps the registered runtime provider id to the namespace its AI SDK model
 * reads from `providerOptions`.
 */
export function resolveProviderOptionsKey(
  providerId: AppProviderId,
  context?: {
    actualProviderId?: string
    endpointType?: EndpointType
    gatewayProviderOptionsKey?: string
  }
): string {
  if (context?.gatewayProviderOptionsKey) return context.gatewayProviderOptionsKey

  switch (providerId) {
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
      return 'openai'
    case 'anthropic':
    case 'azure-anthropic':
      return 'anthropic'
    case 'google':
      return 'google'
    case 'google-vertex':
    case 'google-vertex-anthropic':
    case 'google-vertex-maas':
      return 'vertex'
    case 'xai':
    case 'xai-responses':
      return 'xai'
    case 'bedrock':
      return 'bedrock'
    case SystemProviderIds.ollama:
      return 'ollama'
    case 'github-copilot-openai-compatible':
    case 'openai-compatible':
      return context?.actualProviderId ?? providerId
    case 'cherryin':
    case 'cherryin-chat':
    case 'newapi':
    case 'aihubmix':
    case SystemProviderIds.dmxapi:
    case SystemProviderIds.gateway:
      if (context?.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) return 'anthropic'
      if (context?.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return 'google'
      if (context?.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) return 'openai'
      return providerId
    default:
      return providerId
  }
}
