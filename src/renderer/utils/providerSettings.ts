import { hostFeatures } from '@renderer/utils/hostFeatures'
import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import type { Provider } from '@shared/data/types/provider'
import { isCherryAIProvider, isLoginBasedProvider, matchesPreset } from '@shared/utils/provider'

export function isProviderSettingsListVisibleProvider(provider: Provider): boolean {
  // The local embedding provider is download-managed, so exposing generic
  // edit/disable/delete controls would bypass its weight lifecycle checks.
  if (isCherryAIProvider(provider) || provider.id === LOCAL_EMBEDDING_PROVIDER_ID) return false
  return hostFeatures.providerSignIn || !(isLoginBasedProvider(provider) || matchesPreset(provider, 'copilot'))
}
