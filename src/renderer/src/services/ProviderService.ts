import store from '@renderer/store'
import { Model, Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'

export function getProviderName(model?: Model) {
  const provider = getProviderByModel(model)

  if (!provider) {
    return ''
  }

  return getFancyProviderName(provider)
}

export function getProviderByModel(model?: Model) {
  const id = model?.provider
  const provider = store.getState().llm.providers.find((p) => p.id === id)

  if (provider?.id === 'cherryin') {
    const map = {
      'glm-4.5-flash': 'zhipu',
      'Qwen/Qwen3-8B': 'silicon'
    }

    const providerId = map[model?.id as keyof typeof map]

    if (providerId) {
      return getProviderById(providerId)
    }
  }

  return provider
}

export function isProviderSupportAuth(provider: Provider) {
  const supportProviders = ['302ai', 'silicon', 'aihubmix', 'ppio', 'tokenflux', 'aionly']
  return supportProviders.includes(provider.id)
}

export function isProviderSupportCharge(provider: Provider) {
  const supportProviders = ['302ai', 'silicon', 'aihubmix', 'ppio']
  return supportProviders.includes(provider.id)
}

export function getProviderById(id: string) {
  return store.getState().llm.providers.find((p) => p.id === id)
}
