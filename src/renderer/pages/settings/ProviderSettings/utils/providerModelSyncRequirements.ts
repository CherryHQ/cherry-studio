import type { Provider } from '@shared/data/types/provider'
import { matchesPreset } from '@shared/utils/provider'

export function providerNeedsApiKeyForModelSync(provider: Provider): boolean {
  // `authOptional` is the registry flag for credential-free local servers
  // (ollama / lmstudio / gpustack / ovms); it survives duplication because it
  // rides the merged Provider, not the runtime id.
  // `api-key-aws` is intentionally NOT exempt: unlike `iam-aws` (IAM access
  // keys), it authenticates with an AWS-issued bearer-token API key and
  // therefore still needs an enabled key.
  // Registry-sourced providers (login-based CLI providers: claude-code, codex,
  // grok-cli) serve their model list from the shipped catalog, not an API call,
  // so model sync needs no key — without this they'd never materialize models
  // into `user_model` after login and the selector would show nothing.
  return !(
    provider.authOptional === true ||
    provider.modelListSource === 'registry' ||
    matchesPreset(provider, 'copilot') ||
    provider.authType === 'iam-gcp' ||
    provider.authType === 'iam-aws'
  )
}
