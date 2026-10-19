import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import { LOCAL_LLM_PROVIDER_ID } from '@shared/data/presets/localLlm'
import type { Provider } from '@shared/data/types/provider'
import { isCherryAIProvider } from '@shared/utils/provider'

export function isProviderSettingsListVisibleProvider(provider: Provider): boolean {
  // The local providers are download-managed, so exposing generic
  // edit/disable/delete controls would bypass their weight lifecycle checks.
  return (
    !isCherryAIProvider(provider) &&
    provider.id !== LOCAL_EMBEDDING_PROVIDER_ID &&
    provider.id !== LOCAL_LLM_PROVIDER_ID
  )
}
