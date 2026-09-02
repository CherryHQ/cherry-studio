import type { Provider } from '@shared/data/types/provider'
import type { AppEdition } from '@shared/types/appEdition'

export function isProviderAvailableInEdition(provider: Provider, edition: AppEdition): boolean {
  return provider.supportedEditions?.includes(edition) ?? true
}
