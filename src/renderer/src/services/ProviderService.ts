import store from '@renderer/store'
import { Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'

export function getProviderName(id: string) {
  const provider = store.getState().llm.providers.find((p) => p.id === id)
  if (!provider) {
    return ''
  }

  return getFancyProviderName(provider)
}

export function isProviderSupportAuth(provider: Provider) {
  const supportProviders = ['302ai', 'silicon', 'aihubmix', 'ppio', 'tokenflux']
  return supportProviders.includes(provider.id)
}

export function isProviderSupportCharge(provider: Provider) {
  const supportProviders = ['302ai', 'silicon', 'aihubmix', 'ppio']
  return supportProviders.includes(provider.id)
}
