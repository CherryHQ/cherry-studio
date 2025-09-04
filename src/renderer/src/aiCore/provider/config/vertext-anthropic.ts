import type { Provider } from '@renderer/types'

import { provider2Provider, startsWith } from './helper'
import type { RuleSet } from './types'

const VERTEX_ANTHROPIC_RULES: RuleSet = {
  rules: [
    {
      match: startsWith('claude'),
      provider: (provider: Provider) => ({
        ...provider,
        id: 'google-vertex-anthropic'
      })
    }
  ],
  fallbackRule: (provider: Provider) => provider
}

export const vertexAnthropicProviderCreator = provider2Provider.bind(null, VERTEX_ANTHROPIC_RULES)
