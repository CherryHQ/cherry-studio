import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { Provider } from '@renderer/types'

export function getProviderName(id: string) {
  const provider = store.getState().llm.providers.find((p) => p.id === id)
  if (!provider) {
    return ''
  }

  if (provider.isSystem) {
    return i18n.t(`provider.${provider.id}`, { defaultValue: provider.name })
  }

  return provider?.name
}

export function isProviderSupportAuth(provider: Provider) {
  const supportProviders = ['silicon', 'aihubmix']
  return supportProviders.includes(provider.id)
}

export function isProviderSupportCharge(provider: Provider) {
  const supportProviders = ['silicon', 'aihubmix']
  return supportProviders.includes(provider.id)
}
