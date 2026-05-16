import { getStoreProviders } from '@renderer/hooks/useStore'

export function getProviderById(id: string) {
  return getStoreProviders().find((p) => p.id === id)
}
