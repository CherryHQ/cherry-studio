import { isSystemProviderId } from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { isDeepSeekHybridInferenceModel } from './reasoning'
import { getCapabilityState } from './shared'
import type { ProviderSettingsCapabilityModel } from './types'
import { isPureGenerateImageModel } from './vision'

const FUNCTION_CALLING_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'gpt-4.5',
  'gpt-oss(?:-[\\w-]+)',
  'gpt-5(?:-[0-9-]+)?',
  'o(1|3|4)(?:-[\\w-]+)?',
  'claude',
  'qwen',
  'qwen3',
  'hunyuan',
  'deepseek',
  'glm-4(?:-[\\w-]+)?',
  'glm-4.5(?:-[\\w-]+)?',
  'glm-4.7(?:-[\\w-]+)?',
  'glm-5(?:-[\\w-]+)?',
  'learnlm(?:-[\\w-]+)?',
  'gemini(?:-[\\w-]+)?',
  'gemma-?4(?:[-.\\w]+)?',
  'grok-3(?:-[\\w-]+)?',
  'grok-4(?:-[\\w-]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-2[.-]0(?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-k2(?:-[\\w-]+)?',
  'ling-\\w+(?:-[\\w-]+)?',
  'ring-\\w+(?:-[\\w-]+)?',
  'minimax-m2(?:\\.\\d+)?(?:-[\\w-]+)?',
  'mimo-v2-flash',
  'mimo-v2-pro',
  'mimo-v2-omni',
  'glm-5v-turbo'
]

const FUNCTION_CALLING_EXCLUDED_MODELS = [
  'aqa(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'o1-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1',
  'gemini-1(?:\\.[\\w-]+)?',
  'qwen-mt(?:-[\\w-]+)?',
  'gpt-5-chat(?:-[\\w-]+)?',
  'glm-4\\.5v',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?',
  'deepseek-v3.2-speciale'
]

const FUNCTION_CALLING_REGEX = new RegExp(
  `\\b(?!(?:${FUNCTION_CALLING_EXCLUDED_MODELS.join('|')})\\b)(?:${FUNCTION_CALLING_MODELS.join('|')})\\b`,
  'i'
)

export function isFunctionCallingModel(
  model?: ProviderSettingsCapabilityModel & Pick<Model, 'endpointTypes'>
): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isPureGenerateImageModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'function_calling')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  if (model.providerId === 'doubao' || modelId.includes('doubao')) {
    return FUNCTION_CALLING_REGEX.test(modelId) || FUNCTION_CALLING_REGEX.test(model.name)
  }

  if (isDeepSeekHybridInferenceModel(model)) {
    if (isSystemProviderId(model.providerId)) {
      switch (model.providerId) {
        case 'dashscope':
        case 'doubao':
          return false
      }
    }
    return true
  }

  return FUNCTION_CALLING_REGEX.test(modelId)
}
