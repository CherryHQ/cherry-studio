/**
 * NewAPI规则集
 */
import { Provider } from '@renderer/types'

import { endpointIs, provider2Provider } from './helper'
import type { ModelRule } from './types'

const NEWAPI_RULES: ModelRule[] = [
  {
    name: 'anthropic',
    match: endpointIs('anthropic'),
    provider: (provider: Provider) => {
      return {
        ...provider,
        type: 'anthropic'
      }
    }
  },
  {
    name: 'gemini',
    match: endpointIs('gemini'),
    provider: (provider: Provider) => {
      return {
        ...provider,
        type: 'gemini'
      }
    }
  },
  {
    name: 'openai-response',
    match: endpointIs('openai-response'),
    provider: (provider: Provider) => {
      return {
        ...provider,
        type: 'openai-response'
      }
    }
  },
  {
    name: 'openai',
    match: (model) => endpointIs('openai')(model) || endpointIs('image-generation')(model),
    provider: (provider: Provider) => {
      return {
        ...provider,
        type: 'openai'
      }
    }
  }
]

export const newApiResolverCreator = provider2Provider.bind(null, NEWAPI_RULES)
