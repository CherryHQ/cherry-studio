/**
 * AiHubMix规则集
 */
import type { MinimalModel, MinimalProvider } from '@shared/types'

import { isOpenAILLMModel, modelIdStartsWith, provider2Provider } from './helper'
import type { RuleSet } from './types'

const extraProviderConfig = <P extends MinimalProvider>(provider: P) => {
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
      match: modelIdStartsWith('claude'),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return extraProviderConfig({
          ...provider,
          type: 'anthropic'
        }) as T
      }
    },
    {
      match: (model) =>
        (modelIdStartsWith('gemini')(model) || modelIdStartsWith('imagen')(model)) &&
        !model.id.endsWith('-nothink') &&
        !model.id.endsWith('-search') &&
        !model.id.includes('embedding'),
      provider: <T extends MinimalProvider>(provider: T): T => {
        return extraProviderConfig({
          ...provider,
          type: 'gemini',
          apiHost: 'https://aihubmix.com/gemini'
        }) as T
      }
    },
    {
      match: isOpenAILLMModel,
      provider: <T extends MinimalProvider>(provider: T): T => {
        return extraProviderConfig({
          ...provider,
          type: 'openai-response'
        }) as T
      }
    }
  ],
  fallbackRule: <T extends MinimalProvider>(provider: T): T => extraProviderConfig(provider)
}

export const aihubmixProviderCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider(AIHUBMIX_RULES, model, provider)

export { isOpenAILLMModel }
