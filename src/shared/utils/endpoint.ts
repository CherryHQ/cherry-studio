import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'

export interface CanonicalEndpointSelection {
  endpointType: EndpointType | undefined
  gatewayProviderOptionsKey?: string
}

export type EndpointSelectionProvider = Pick<
  Provider,
  'id' | 'presetProviderId' | 'defaultChatEndpoint' | 'endpointConfigs'
>

/**
 * Select the endpoint protocol shared by main-process requests and endpoint-aware consumers.
 *
 * A candidate is usable only when the provider still has configuration for it. Dedicated
 * non-chat models never inherit chat defaults or chat gateway routes, including capability-only
 * models whose catalog row has no `endpointTypes` hint.
 */
export function resolveCanonicalEndpoint(
  provider: EndpointSelectionProvider,
  model: Model,
  preferredEndpointType?: EndpointType
): CanonicalEndpointSelection {
  // Persisted/custom rows created before capabilities became required can still omit the array.
  // Classify them as ordinary chat models unless another explicit non-chat signal is present.
  const nonChat = isNonChatModel({ ...model, capabilities: model.capabilities ?? [] })
  const hasEndpointConfig = (endpointType: EndpointType | undefined): endpointType is EndpointType =>
    Boolean(endpointType && provider.endpointConfigs?.[endpointType])
  const defaultEndpoint = provider.defaultChatEndpoint
  const preferred =
    !nonChat &&
    preferredEndpointType &&
    model.endpointTypes?.includes(preferredEndpointType) &&
    provider.endpointConfigs?.[preferredEndpointType]?.baseUrl
      ? preferredEndpointType
      : undefined
  const supportedProviderDefault =
    !nonChat && defaultEndpoint && model.endpointTypes?.includes(defaultEndpoint) && hasEndpointConfig(defaultEndpoint)
      ? defaultEndpoint
      : undefined
  const modelEndpoint = model.endpointTypes?.find(hasEndpointConfig)
  const gatewayRoute = nonChat ? undefined : resolveGatewayChatRoute(provider, model)
  const fallback =
    !nonChat && !model.endpointTypes?.length && hasEndpointConfig(defaultEndpoint) ? defaultEndpoint : undefined
  const endpointType = preferred ?? supportedProviderDefault ?? modelEndpoint ?? gatewayRoute?.endpointType ?? fallback

  return {
    endpointType,
    gatewayProviderOptionsKey:
      gatewayRoute && endpointType === gatewayRoute.endpointType ? gatewayRoute.providerOptionsKey : undefined
  }
}
