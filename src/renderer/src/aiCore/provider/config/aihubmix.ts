/**
 * AiHubMix规则集
 */
import { isOpenAIModel } from '@renderer/config/models'
import { Provider } from '@renderer/types'

import { startsWith } from './helper'
import { provider2Provider } from './helper'
import type { ModelRule } from './types'

const extraProviderConfig = (provider: Provider) => {
  return {
    ...provider,
    extra_headers: {
      ...provider.extra_headers,
      'APP-Code': 'MLTG2087'
    }
  }
}

const AIHUBMIX_RULES: ModelRule[] = [
  {
    name: 'claude',
    match: startsWith('claude'),
    provider: (provider: Provider) => {
      return extraProviderConfig({
        ...provider,
        type: 'anthropic'
      })
    }
  },
  {
    name: 'gemini',
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
    name: 'openai',
    match: isOpenAIModel,
    provider: (provider: Provider) => {
      return extraProviderConfig({
        ...provider,
        type: 'openai-response'
      })
    }
  }
]

export const aihubmixProviderCreator = provider2Provider.bind(null, AIHUBMIX_RULES)
