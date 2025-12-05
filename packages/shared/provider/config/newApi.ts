/**
 * NewAPI规则集
 */
import type { MinimalModel, MinimalProvider, ProviderType } from '../types'
import { endpointIs, provider2Provider } from './helper'
import type { RuleSet } from './types'

const NEWAPI_RULES: RuleSet = {
  rules: [
    {
      match: endpointIs('anthropic'),
      provider: (provider) => {
        return {
          ...provider,
          type: 'anthropic' as ProviderType
        }
      }
    },
    {
      match: endpointIs('gemini'),
      provider: (provider) => {
        return {
          ...provider,
          type: 'gemini' as ProviderType
        }
      }
    },
    {
      match: endpointIs('openai-response'),
      provider: (provider) => {
        return {
          ...provider,
          type: 'openai-response' as ProviderType
        }
      }
    },
    {
      match: (model) => endpointIs('openai')(model) || endpointIs('image-generation')(model),
      provider: (provider) => {
        return {
          ...provider,
          type: 'openai' as ProviderType
        }
      }
    }
  ],
  fallbackRule: (provider) => provider
}

export const newApiResolverCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider<MinimalModel, MinimalProvider, P>(NEWAPI_RULES, model, provider)
