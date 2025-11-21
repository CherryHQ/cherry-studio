import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/pages/code'
import type { AzureOpenAIProvider, Provider } from '@renderer/types'

export const isAzureResponsesEndpoint = (provider: AzureOpenAIProvider) => {
  return provider.apiVersion === 'preview' || provider.apiVersion === 'v1'
}

export const getClaudeSupportedProviders = (providers: Provider[]) => {
  return providers.filter((p) => p.type === 'anthropic' || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id))
}
