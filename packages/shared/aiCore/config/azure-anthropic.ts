import type { MinimalModel, MinimalProvider } from '@shared/types'

import { modelIdStartsWith, provider2Provider } from './helper'
import type { RuleSet } from './types'

// https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry
const AZURE_ANTHROPIC_RULES: RuleSet = {
  rules: [
    {
      match: modelIdStartsWith('claude'),
      provider: <T extends MinimalProvider>(provider: T): T =>
        ({
          ...provider,
          type: 'anthropic',
          apiHost: provider.apiHost + 'anthropic/v1',
          id: 'azure-anthropic'
        }) as T
    }
  ],
  fallbackRule: <T extends MinimalProvider>(provider: T): T => provider
}

export const azureAnthropicProviderCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider(AZURE_ANTHROPIC_RULES, model, provider)
