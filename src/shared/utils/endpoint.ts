import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE, endpointImpliedCapability, type EndpointType, type Model } from '@shared/data/types/model'
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
  preferredEndpointType?: EndpointType,
  allowedEndpointTypes?: readonly EndpointType[]
): CanonicalEndpointSelection {
  // Persisted/custom rows created before capabilities became required can still omit the array.
  // Classify them as ordinary chat models unless another explicit non-chat signal is present.
  const nonChat = isNonChatModel({ ...model, capabilities: model.capabilities ?? [] })
  const isAllowed = (endpointType: EndpointType | undefined): endpointType is EndpointType =>
    Boolean(endpointType && (!allowedEndpointTypes || allowedEndpointTypes.includes(endpointType)))
  const hasEndpointConfig = (endpointType: EndpointType | undefined): endpointType is EndpointType =>
    isAllowed(endpointType) && Boolean(provider.endpointConfigs?.[endpointType])
  const endpointBackedCapabilities = new Set(
    Object.values(ENDPOINT_TYPE)
      .map(endpointImpliedCapability)
      .filter((capability) => capability !== undefined)
  )
  const hasExplicitEndpointCapability = model.capabilities.some((capability) =>
    endpointBackedCapabilities.has(capability)
  )
  const matchesModelMode = (endpointType: EndpointType): boolean => {
    const impliedCapability = endpointImpliedCapability(endpointType)
    if (!nonChat) return impliedCapability === undefined
    if (impliedCapability === undefined) return false
    return !hasExplicitEndpointCapability || model.capabilities.includes(impliedCapability)
  }
  const defaultEndpoint = provider.defaultChatEndpoint
  const preferred =
    !nonChat &&
    isAllowed(preferredEndpointType) &&
    model.endpointTypes?.includes(preferredEndpointType) &&
    provider.endpointConfigs?.[preferredEndpointType]?.baseUrl
      ? preferredEndpointType
      : undefined
  const supportedProviderDefault =
    !nonChat && defaultEndpoint && model.endpointTypes?.includes(defaultEndpoint) && hasEndpointConfig(defaultEndpoint)
      ? defaultEndpoint
      : undefined
  const modelEndpoint = model.endpointTypes?.find(
    (endpointType) => hasEndpointConfig(endpointType) && matchesModelMode(endpointType)
  )
  const gatewayRoute = nonChat ? undefined : resolveGatewayChatRoute(provider, model)
  const fallback =
    !nonChat && !model.endpointTypes?.length && hasEndpointConfig(defaultEndpoint) ? defaultEndpoint : undefined
  const gatewayEndpoint = isAllowed(gatewayRoute?.endpointType) ? gatewayRoute?.endpointType : undefined
  const endpointType = preferred ?? supportedProviderDefault ?? modelEndpoint ?? gatewayEndpoint ?? fallback

  return {
    endpointType,
    gatewayProviderOptionsKey:
      gatewayRoute && endpointType === gatewayRoute.endpointType ? gatewayRoute.providerOptionsKey : undefined
  }
}
