import type { Provider } from '@shared/data/types/provider'
import { isOllamaProvider, matchesPreset } from '@shared/utils/provider'

export function providerNeedsApiKeyForModelSync(provider: Provider): boolean {
  // `authOptional` is the registry flag for credential-free local servers
  // (ollama / lmstudio / gpustack / ovms); it rides the merged Provider, so it
  // survives duplication (inherited via presetProviderId).
  // `isOllamaProvider` is kept as an endpoint fallback: a self-hosted Ollama
  // gateway added as a fully custom provider (no preset link) carries no
  // `authOptional`, but its `ollama-chat` endpoint still identifies it — without
  // this it would drop into the key-required path and never sync models.
  // `api-key-aws` is intentionally NOT exempt: unlike `iam-aws` (IAM access
  // keys), it authenticates with an AWS-issued bearer-token API key and
  // therefore still needs an enabled key.
  // Registry-sourced providers (login-based CLI providers: claude-code, codex,
  // grok-cli) serve their model list from the shipped catalog, not an API call,
  // so model sync needs no key — without this they'd never materialize models
  // into `user_model` after login and the selector would show nothing.
  return !(
    provider.authOptional === true ||
    isOllamaProvider(provider) ||
    provider.modelListSource === 'registry' ||
    matchesPreset(provider, 'copilot') ||
    provider.authType === 'iam-gcp' ||
    provider.authType === 'iam-aws'
  )
}
