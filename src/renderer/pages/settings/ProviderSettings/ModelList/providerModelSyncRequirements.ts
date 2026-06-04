import type { Provider } from '@shared/data/types/provider'

export function providerNeedsApiKeyForModelSync(provider: Provider): boolean {
  return !(
    provider.id === 'ollama' ||
    provider.id === 'lmstudio' ||
    provider.id === 'copilot' ||
    provider.authType === 'iam-gcp' ||
    provider.authType === 'iam-aws'
  )
}
