import type { MinimalModel, MinimalProvider } from '../types'
import { provider2Provider, startsWith } from './helper'
import type { RuleSet } from './types'

const VERTEX_ANTHROPIC_RULES: RuleSet = {
  rules: [
    {
      match: startsWith('claude'),
      provider: (provider: MinimalProvider) => ({
        ...provider,
        id: 'google-vertex-anthropic'
      })
    }
  ],
  fallbackRule: (provider: MinimalProvider) => provider
}

export const vertexAnthropicProviderCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider<MinimalModel, MinimalProvider, P>(VERTEX_ANTHROPIC_RULES, model, provider)
