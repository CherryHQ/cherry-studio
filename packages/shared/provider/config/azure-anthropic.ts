import type { MinimalModel, MinimalProvider, ProviderType } from '../types'
import { provider2Provider, startsWith } from './helper'
import type { RuleSet } from './types'

// https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry
const AZURE_ANTHROPIC_RULES: RuleSet = {
  rules: [
    {
      match: startsWith('claude'),
      provider: (provider: MinimalProvider) => ({
        ...provider,
        type: 'anthropic' as ProviderType,
        apiHost: provider.apiHost + 'anthropic/v1',
        id: 'azure-anthropic'
      })
    }
  ],
  fallbackRule: (provider: MinimalProvider) => provider
}

export const azureAnthropicProviderCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider<MinimalModel, MinimalProvider, P>(AZURE_ANTHROPIC_RULES, model, provider)
