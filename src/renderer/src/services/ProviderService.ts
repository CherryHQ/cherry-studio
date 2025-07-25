import { getProviderLabel } from '@renderer/i18n/label'
import store from '@renderer/store'
import { Provider } from '@renderer/types'

export function getProviderName(id: string) {
  const provider = store.getState().llm.providers.find((p) => p.id === id)
  if (!provider) {
    return ''
  }

  if (provider.isSystem) {
    return getProviderLabel(provider.id) ?? provider.name
  }

  return provider?.name
}

export function isProviderSupportAuth(provider: Provider) {
  const supportProviders = ['silicon', 'aihubmix', 'ppio', 'tokenflux']
  return supportProviders.includes(provider.id)
}

export function isProviderSupportCharge(provider: Provider) {
  const supportProviders = ['silicon', 'aihubmix', 'ppio']
  return supportProviders.includes(provider.id)
}
