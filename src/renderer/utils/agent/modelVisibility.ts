import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isExternalCliProvider } from '@shared/utils/provider'

/** Until Cloud supplies per-surface capabilities, Cloud and external-CLI catalogs are Agent-only. */
export function isProviderVisibleOutsideAgent(provider: Pick<Provider, 'id' | 'authMethods'>): boolean {
  return !isManagedCherryCloudModel(provider.id) && !isExternalCliProvider(provider)
}

export function isModelVisibleOutsideAgent(
  model: Pick<Model, 'providerId'>,
  provider?: Pick<Provider, 'id' | 'authMethods'>
): boolean {
  return !isManagedCherryCloudModel(model.providerId) && (!provider || isProviderVisibleOutsideAgent(provider))
}
