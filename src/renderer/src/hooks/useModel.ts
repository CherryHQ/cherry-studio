import store from '@renderer/store'

import { useProviders } from './useProvider'

export function useModel(id?: string, providerId?: string) {
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  return allModels.find((m) => {
    if (providerId) {
      return m.id === id && m.provider === providerId
    } else {
      return m.id === id
    }
  })
}

export function getModel(id?: string, providerId?: string) {
  const providers = store.getState().llm.providers
  const allModels = providers.map((p) => p.models).flat()
  return allModels.find((m) => {
    if (providerId) {
      return m.id === id && m.provider === providerId
    } else {
      return m.id === id
    }
  })
}
