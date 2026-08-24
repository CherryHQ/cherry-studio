import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/** Return the provider preference only when the model explicitly advertises it. */
export function getSupportedProviderDefaultEndpoint(
  provider: Pick<Provider, 'defaultChatEndpoint'>,
  model: Pick<Model, 'endpointTypes'>
) {
  const endpointType = provider.defaultChatEndpoint
  return endpointType && model.endpointTypes?.includes(endpointType) ? endpointType : undefined
}
