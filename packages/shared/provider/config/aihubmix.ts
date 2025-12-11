/**
 * AiHubMix规则集
 */
import { getLowerBaseModelName } from '@shared/utils/naming'

import type { MinimalModel, MinimalProvider } from '../types'
import { provider2Provider, startsWith } from './helper'
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

function isOpenAILLMModel<M extends MinimalModel>(model: M): boolean {
  const modelId = getLowerBaseModelName(model.id)
  const reasonings = ['o1', 'o3', 'o4', 'gpt-oss']
  if (reasonings.some((r) => modelId.includes(r))) {
    return true
  }
  if (modelId.includes('gpt')) {
    return true
  }
  return false
}

const AIHUBMIX_RULES: RuleSet = {
  rules: [
    {
      match: startsWith('claude'),
      provider: (provider) => {
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
        !model.id.endsWith('-search') &&
        !model.id.includes('embedding'),
      provider: (provider) => {
        return extraProviderConfig({
          ...provider,
          type: 'gemini',
          apiHost: 'https://aihubmix.com/gemini'
        })
      }
    },
    {
      match: isOpenAILLMModel,
      provider: (provider) => {
        return extraProviderConfig({
          ...provider,
          type: 'openai-response'
        })
      }
    }
  ],
  fallbackRule: (provider) => extraProviderConfig(provider)
}

export const aihubmixProviderCreator = <P extends MinimalProvider>(model: MinimalModel, provider: P): P =>
  provider2Provider<MinimalModel, MinimalProvider, P>(AIHUBMIX_RULES, model, provider)
