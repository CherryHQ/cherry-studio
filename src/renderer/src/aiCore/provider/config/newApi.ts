/**
 * NewAPI规则集
 */
import { Provider } from '@renderer/types'

import { endpointIs, provider2Provider } from './helper'
import type { RuleSet } from './types'

const NEWAPI_RULES: RuleSet = {
  rules: [
    {
      match: endpointIs('anthropic'),
      provider: (provider: Provider) => {
        return {
          ...provider,
          type: 'anthropic'
        }
      }
    },
    {
      match: endpointIs('gemini'),
      provider: (provider: Provider) => {
        return {
          ...provider,
          type: 'gemini'
        }
      }
    },
    {
      match: endpointIs('openai-response'),
      provider: (provider: Provider) => {
        return {
          ...provider,
          type: 'openai-response'
        }
      }
    },
    {
      match: (model) => endpointIs('openai')(model) || endpointIs('image-generation')(model),
      provider: (provider: Provider) => {
        return {
          ...provider,
          type: 'openai'
        }
      }
    }
  ],
  fallbackRule: (provider: Provider) => provider
}

export const newApiResolverCreator = provider2Provider.bind(null, NEWAPI_RULES)
