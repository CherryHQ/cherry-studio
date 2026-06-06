import type { Provider } from '@shared/data/types/provider'
import { isOllamaProvider, matchesPreset } from '@shared/utils/provider'

export function providerNeedsApiKeyForModelSync(provider: Provider): boolean {
  // Preset-aware: a duplicated local provider keeps `presetProviderId` but gets a
  // new `id`, so matching on `provider.id` alone would misclassify the copy as
  // key-required and leave it disabled. Match the preset instead.
  return !(
    isOllamaProvider(provider) ||
    matchesPreset(provider, 'lmstudio') ||
    matchesPreset(provider, 'copilot') ||
    provider.authType === 'iam-gcp' ||
    provider.authType === 'iam-aws'
  )
}
