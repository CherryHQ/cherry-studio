/**
 * AiHubMix规则集
 */
import { isOpenAIModel } from '@renderer/config/models'
import { Provider } from '@renderer/types'

import { provider2Provider, startsWith } from './helper'
import type { RuleSet } from './types'

const extraProviderConfig = (provider: Provider) => {
  return {
    ...provider,
    extra_headers: {
      ...provider.extra_headers,
      'APP-Code': 'MLTG2087'
    }
  }
}

const AIHUBMIX_RULES: RuleSet = {
  rules: [
    {
      match: startsWith('claude'),
      provider: (provider: Provider) => {
        return extraProviderConfig({
          ...provider,
          type: 'anthropic'
        })
      }
    },
    {
      match: (model) =>
        (startsWith('gemini')(model) || startsWith('imagen')(model)) &&
        !model.id.endsWith('-nothink') &&
        !model.id.endsWith('-search'),
      provider: (provider: Provider) => {
        return extraProviderConfig({
          ...provider,
          type: 'gemini',
          apiHost: 'https://aihubmix.com/gemini'
        })
      }
    },
    {
      match: isOpenAIModel,
      provider: (provider: Provider) => {
        return extraProviderConfig({
          ...provider,
          type: 'openai-response'
        })
      }
    }
  ],
  fallbackRule: (provider: Provider) => provider
}

export const aihubmixProviderCreator = provider2Provider.bind(null, AIHUBMIX_RULES)
