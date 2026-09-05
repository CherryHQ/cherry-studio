/**
 * Endpoint + AI SDK provider id resolution. See
 * `docs/references/ai/adapter-family.md` for design rationale.
 */

import { isEndpointCompatibleWithOperation, type ModelOperationCapability } from '@cherrystudio/provider-registry'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { getRawModelId } from '@shared/utils/model'
import { getModelPreferredEndpoint, isModelEndpointTypeAvailable } from '@shared/utils/provider'
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
 * The model id as it must appear on the wire.
 *
 * Gemini's `/models` listing names models `models/<id>`; the prefix is stripped at
 * ingestion today, but rows synced before that still carry it. Both forms build the
 * same request URL, so the difference is invisible — except that `@ai-sdk/google`
 * matches its feature allowlists (googleSearch, urlContext, code execution, …)
 * against the id EXACTLY, so a prefixed id silently drops those tools from the
 * request. Normalise once here rather than teaching every consumer about it.
 */
export function resolveWireModelId(model: Model, endpointType: EndpointType | undefined): string {
  const rawId = getRawModelId(model)
  return endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT ? rawId.replace(/^models\//, '') : rawId
}

/**
 * Priority: compatible caller requirement → compatible preference → first compatible model endpoint.
 * Text generation alone may then inherit a gateway route or the provider's default chat endpoint.
 *
 * Hard requirements belong to runtimes that speak exactly one dialect. Every candidate is checked
 * against the model's current capability set and the provider's live endpoint configs.
 */
export function resolveEffectiveEndpoint(
  provider: Provider,
  model: Model,
  options: { operationCapability: ModelOperationCapability; requiredEndpointType?: EndpointType }
): ResolvedEndpoint {
  const gatewayRoute = resolveGatewayRoute(provider, model)
  const isRuntimeCandidateAvailable = (endpointType: EndpointType) =>
    isEndpointCompatibleWithOperation(endpointType, options.operationCapability) &&
    isModelEndpointTypeAvailable(model, provider, endpointType)
  const requiredEndpoint =
    options.requiredEndpointType && isRuntimeCandidateAvailable(options.requiredEndpointType)
      ? options.requiredEndpointType
      : undefined
  const userPreferredEndpoint =
    model.preferredEndpointType &&
    isEndpointCompatibleWithOperation(model.preferredEndpointType, options.operationCapability) &&
    isModelEndpointTypeAvailable(model, provider, model.preferredEndpointType)
      ? model.preferredEndpointType
      : undefined
  const selectedEndpoint = requiredEndpoint ?? userPreferredEndpoint
  const endpointType = selectedEndpoint ?? getModelPreferredEndpoint(model, provider, options.operationCapability)
  const endpointRequiresOwnHost =
    endpointType !== undefined &&
    (selectedEndpoint !== undefined || !isModelEndpointTypeAvailable(model, provider, endpointType))
  const hasEndpointConfig =
    endpointType !== undefined &&
    provider.endpointConfigs != null &&
    Object.hasOwn(provider.endpointConfigs, endpointType)
  const providerOptionsKey =
    gatewayRoute && endpointType === gatewayRoute.endpointType ? gatewayRoute.providerOptionsKey : undefined
  return {
    endpointType,
    baseUrl: endpointType
      ? getBaseUrl(provider, endpointType, {
          // A configured adapter may reuse the provider's default host; an unserved protocol fails closed.
          selectedEndpointOnly: endpointRequiresOwnHost && !hasEndpointConfig
        })
      : '',
    providerOptionsKey
  }
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
    // open-responses included: `createOpenResponses({ name: 'openai' })` keeps
    // the wire namespace 'openai'.
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
    case 'open-responses':
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

/**
 * Single derivation of the providerOptions namespace for a resolved endpoint:
 * adapter id via {@link resolveAiSdkProviderId}, then its namespace via
 * {@link resolveProviderOptionsKey}. Gateway consumers must use this instead of
 * composing the two calls themselves so reasoning options and other
 * provider-option writers can never disagree on the namespace.
 */
export function resolveEndpointProviderOptionsKey(provider: Provider, resolvedEndpoint: ResolvedEndpoint): string {
  return resolveProviderOptionsKey(resolveAiSdkProviderId(provider, resolvedEndpoint.endpointType), {
    actualProviderId: provider.id,
    endpointType: resolvedEndpoint.endpointType,
    gatewayProviderOptionsKey: resolvedEndpoint.providerOptionsKey
  })
}
