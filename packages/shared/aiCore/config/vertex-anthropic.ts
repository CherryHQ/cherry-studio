import type { MinimalModel, MinimalProvider } from '@shared/types'

import { modelIdStartsWith, provider2Provider } from './helper'
import type { RuleSet } from './types'

const VERTEX_ANTHROPIC_RULES: RuleSet = {
  rules: [
    {
      match: modelIdStartsWith('claude'),
      provider: <T extends MinimalProvider>(provider: T): T => ({
        ...provider,
        id: 'google-vertex-anthropic'
      })
    }
  ],
  fallbackRule: <T extends MinimalProvider>(provider: T): T => provider
}

export const vertexAnthropicProviderCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider(VERTEX_ANTHROPIC_RULES, model, provider)
