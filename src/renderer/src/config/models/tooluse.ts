import { isSystemProviderId, Model } from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { isDeepSeekHybridInferenceModel } from './reasoning'
import { isPureGenerateImageModel, isTextToImageModel } from './vision'

// Tool calling models
export const FUNCTION_CALLING_MODELS = [
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
  'learnlm(?:-[\\w-]+)?',
  'gemini(?:-[\\w-]+)?', // 提前排除了gemini的嵌入模型
  'grok-3(?:-[\\w-]+)?',
  'doubao-seed-1[.-]6(?:-[\\w-]+)?',
  'kimi-k2(?:-[\\w-]+)?'
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
  'glm-4\\.5v'
]

export const FUNCTION_CALLING_REGEX = new RegExp(
  `\\b(?!(?:${FUNCTION_CALLING_EXCLUDED_MODELS.join('|')})\\b)(?:${FUNCTION_CALLING_MODELS.join('|')})\\b`,
  'i'
)

export function isFunctionCallingModel(model?: Model): boolean {
  if (
    !model ||
    isEmbeddingModel(model) ||
    isRerankModel(model) ||
    isTextToImageModel(model) ||
    isPureGenerateImageModel(model)
  ) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (isUserSelectedModelType(model, 'function_calling') !== undefined) {
    return isUserSelectedModelType(model, 'function_calling')!
  }

  if (model.provider === 'qiniu') {
    return ['deepseek-v3-tool', 'deepseek-v3-0324', 'qwq-32b', 'qwen2.5-72b-instruct'].includes(modelId)
  }

  if (model.provider === 'doubao' || modelId.includes('doubao')) {
    return FUNCTION_CALLING_REGEX.test(modelId) || FUNCTION_CALLING_REGEX.test(model.name)
  }

  if (['deepseek', 'anthropic', 'kimi', 'moonshot'].includes(model.provider)) {
    return true
  }

  // 2025/08/26 百炼与火山引擎均不支持 v3.1 函数调用
  // 先默认支持
  if (isDeepSeekHybridInferenceModel(model)) {
    if (isSystemProviderId(model.provider)) {
      switch (model.provider) {
        case 'dashscope':
        case 'doubao':
          // case 'nvidia': // nvidia api 太烂了 测不了能不能用 先假设能用
          return false
      }
    }
    return true
  }

  return FUNCTION_CALLING_REGEX.test(modelId)
}
