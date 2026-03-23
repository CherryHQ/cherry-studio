/**
 * NewAPI规则集
 */
import type { MinimalModel, MinimalProvider } from '@shared/types'

import { endpointIs, provider2Provider } from './helper'
import type { RuleSet } from './types'

const NEWAPI_RULES: RuleSet = {
  rules: [
    {
      match: endpointIs('anthropic'),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return {
          ...provider,
          type: 'anthropic'
        }
      }
    },
    {
      match: endpointIs('gemini'),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return {
          ...provider,
          type: 'gemini'
        }
      }
    },
    {
      match: endpointIs('openai-response'),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return {
          ...provider,
          type: 'openai-response'
        }
      }
    },
    {
      match: (model) => endpointIs('openai')(model) || endpointIs('image-generation')(model),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return {
          ...provider,
          type: 'openai'
        }
      }
    }
  ],
  fallbackRule: <T extends MinimalProvider>(provider: T): T => provider
}

export const newApiResolverCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider(NEWAPI_RULES, model, provider)
