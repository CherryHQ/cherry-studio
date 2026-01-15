import type { Provider } from '@renderer/types'

import { provider2Provider, startsWith } from './helper'
import type { RuleSet } from './types'

// https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry
const AZURE_ANTHROPIC_RULES: RuleSet = {
  rules: [
    {
      match: startsWith('claude'),
      provider: (provider: Provider) => ({
        ...provider,
        type: 'anthropic',
        apiHost: provider.apiHost + 'anthropic/v1',
        id: 'azure-anthropic'
      })
    }
  ],
  fallbackRule: (provider: Provider) => provider
}

export const azureAnthropicProviderCreator = provider2Provider.bind(null, AZURE_ANTHROPIC_RULES)
