import type { Provider } from '@shared/data/types/provider'
import { isOllamaProvider, matchesPreset } from '@shared/utils/provider'

export function providerNeedsApiKeyForModelSync(provider: Provider): boolean {
  // Preset-aware: a duplicated local provider keeps `presetProviderId` but gets a
  // new `id`, so matching on `provider.id` alone would misclassify the copy as
  // key-required and leave it disabled. Match the preset instead.
  // `api-key-aws` is intentionally NOT exempt: unlike `iam-aws` (IAM access
  // keys), it authenticates with an AWS-issued bearer-token API key and
  // therefore still needs an enabled key.
  // Registry-sourced providers (login-based CLI providers: claude-code, codex,
  // grok-cli) serve their model list from the shipped catalog, not an API call,
  // so model sync needs no key — without this they'd never materialize models
  // into `user_model` after login and the selector would show nothing.
  return !(
    provider.modelListSource === 'registry' ||
    isOllamaProvider(provider) ||
    matchesPreset(provider, 'lmstudio') ||
    matchesPreset(provider, 'copilot') ||
    provider.authType === 'iam-gcp' ||
    provider.authType === 'iam-aws'
  )
}
