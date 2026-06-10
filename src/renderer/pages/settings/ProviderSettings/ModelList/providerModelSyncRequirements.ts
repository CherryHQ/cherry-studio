import type { Provider } from '@shared/data/types/provider'
import { isOllamaProvider, matchesPreset } from '@shared/utils/provider'

export function providerNeedsApiKeyForModelSync(provider: Provider): boolean {
  // Preset-aware: a duplicated local provider keeps `presetProviderId` but gets a
  // new `id`, so matching on `provider.id` alone would misclassify the copy as
  // key-required and leave it disabled. Match the preset instead.
  // `api-key-aws` is intentionally NOT exempt: unlike `iam-aws` (IAM access
  // keys), it authenticates with an AWS-issued bearer-token API key and
  // therefore still needs an enabled key.
  return !(
    isOllamaProvider(provider) ||
    matchesPreset(provider, 'lmstudio') ||
    matchesPreset(provider, 'copilot') ||
    provider.authType === 'iam-gcp' ||
    provider.authType === 'iam-aws'
  )
}
