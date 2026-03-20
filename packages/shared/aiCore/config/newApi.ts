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
        } as T
      }
    },
    {
      match: endpointIs('gemini'),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return {
          ...provider,
          type: 'gemini'
        } as T
      }
    },
    {
      match: endpointIs('openai-response'),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return {
          ...provider,
          type: 'openai-response'
        } as T
      }
    },
    {
      match: (model) => endpointIs('openai')(model) || endpointIs('image-generation')(model),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return {
          ...provider,
          type: 'openai'
        } as T
      }
    }
  ],
  fallbackRule: <T extends MinimalProvider>(provider: T): T => provider
}

export const newApiResolverCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider(NEWAPI_RULES, model, provider)
