import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import type { Provider } from '@shared/data/types/provider'
import type { AppEdition } from '@shared/types/appEdition'
import { isCherryAIProvider } from '@shared/utils/provider'

export function isProviderAvailableInEdition(provider: Provider, edition: AppEdition): boolean {
  return provider.supportedEditions?.includes(edition) ?? true
}

export function isProviderSettingsListVisibleProvider(provider: Provider): boolean {
  // The local embedding provider is download-managed, so exposing generic
  // edit/disable/delete controls would bypass its weight lifecycle checks.
  return !isCherryAIProvider(provider) && provider.id !== LOCAL_EMBEDDING_PROVIDER_ID
}
