import { ENDPOINT_CONNECTION_FAMILY, resolveEndpointConnection } from '@cherrystudio/provider-registry'
import { resolveGatewayDefaultEndpoint } from '@shared/data/presets/gatewayChatRouting'
import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/** Shared default selection for Main execution and renderer compatibility previews. */
export function selectChatEndpoint(
  provider: Provider,
  model: Model,
  preferredEndpointType?: EndpointType
): EndpointType | undefined {
  if (
    preferredEndpointType &&
    model.endpointTypes?.includes(preferredEndpointType) &&
    resolveEndpointConnection(provider, preferredEndpointType)
  ) {
    return preferredEndpointType
  }
  return (
    model.endpointTypes?.[0] ??
    resolveGatewayDefaultEndpoint(provider, model.apiModelId ?? model.id) ??
    provider.defaultChatEndpoint ??
    (Object.keys(ENDPOINT_CONNECTION_FAMILY) as EndpointType[]).find(
      (endpoint) => provider.endpointConfigs?.[endpoint]?.baseUrl
    )
  )
}
