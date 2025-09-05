import { getProviderByModel } from '@renderer/services/AssistantService'
import {
  isSystemProviderId,
  Model,
  ReasoningEffortConfig,
  SystemProviderId,
  ThinkingModelType,
  ThinkingOptionConfig
} from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'
import OpenAI from 'openai'

import { WEB_SEARCH_PROMPT_FOR_OPENROUTER } from './prompts'
import { getWebSearchTools } from './tools'

// Vision models
const visionAllowedModels = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-exp',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen2.5-omni',
  'qvq',
  'internvl2',
  'grok-vision-beta',
  'grok-4(?:-[\\w-]+)?',
  'pixtral',
  'gpt-4(?:-[\\w-]+)',
  'gpt-4.1(?:-[\\w-]+)?',
  'gpt-4o(?:-[\\w-]+)?',
  'gpt-4.5(?:-[\\w-]+)',
  'gpt-5(?:-[\\w-]+)?',
  'chatgpt-4o(?:-[\\w-]+)?',
  'o1(?:-[\\w-]+)?',
  'o3(?:-[\\w-]+)?',
  'o4(?:-[\\w-]+)?',
  'deepseek-vl(?:[\\w-]+)?',
  'kimi-latest',
  'gemma-3(?:-[\\w-]+)',
  'doubao-seed-1[.-]6(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  `gemma3(?:[-:\\w]+)?`,
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?'
]

const visionExcludedModels = [
  'gpt-4-\\d+-preview',
  'gpt-4-turbo-preview',
  'gpt-4-32k',
  'gpt-4-\\d+',
  'o1-mini',
  'o3-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1'
]
export const VISION_REGEX = new RegExp(
  `\\b(?!(?:${visionExcludedModels.join('|')})\\b)(${visionAllowedModels.join('|')})\\b`,
  'i'
)

// Text to image models
export const TEXT_TO_IMAGE_REGEX = /flux|diffusion|stabilityai|sd-|dall|cogview|janus|midjourney|mj-|image|gpt-image/i

// Reasoning models
export const REASONING_REGEX =
  /^(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4)(?:-[\w-]+)?\b.*)$/i

// Embedding models
export const EMBEDDING_REGEX =
  /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

// Rerank models
export const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i

export const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i

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

export const CLAUDE_SUPPORTED_WEBSEARCH_REGEX = new RegExp(
  `\\b(?:claude-3(-|\\.)(7|5)-sonnet(?:-[\\w-]+)|claude-3(-|\\.)5-haiku(?:-[\\w-]+)|claude-sonnet-4(?:-[\\w-]+)?|claude-opus-4(?:-[\\w-]+)?)\\b`,
  'i'
)

// 模型类型到支持的reasoning_effort的映射表
// TODO: refactor this. too many identical options
export const MODEL_SUPPORTED_REASONING_EFFORT: ReasoningEffortConfig = {
  default: ['low', 'medium', 'high'] as const,
  o: ['low', 'medium', 'high'] as const,
  gpt5: ['minimal', 'low', 'medium', 'high'] as const,
  grok: ['low', 'high'] as const,
  gemini: ['low', 'medium', 'high', 'auto'] as const,
  gemini_pro: ['low', 'medium', 'high', 'auto'] as const,
  qwen: ['low', 'medium', 'high'] as const,
  qwen_thinking: ['low', 'medium', 'high'] as const,
  doubao: ['auto', 'high'] as const,
  doubao_no_auto: ['high'] as const,
  hunyuan: ['auto'] as const,
  zhipu: ['auto'] as const,
  perplexity: ['low', 'medium', 'high'] as const,
  deepseek_hybrid: ['auto'] as const
} as const

// 模型类型到支持选项的映射表
export const MODEL_SUPPORTED_OPTIONS: ThinkingOptionConfig = {
  default: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.default] as const,
  o: MODEL_SUPPORTED_REASONING_EFFORT.o,
  gpt5: [...MODEL_SUPPORTED_REASONING_EFFORT.gpt5] as const,
  grok: MODEL_SUPPORTED_REASONING_EFFORT.grok,
  gemini: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini] as const,
  gemini_pro: MODEL_SUPPORTED_REASONING_EFFORT.gemini_pro,
  qwen: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.qwen] as const,
  qwen_thinking: MODEL_SUPPORTED_REASONING_EFFORT.qwen_thinking,
  doubao: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao] as const,
  doubao_no_auto: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao_no_auto] as const,
  hunyuan: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.hunyuan] as const,
  zhipu: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.zhipu] as const,
  perplexity: MODEL_SUPPORTED_REASONING_EFFORT.perplexity,
  deepseek_hybrid: ['off', ...MODEL_SUPPORTED_REASONING_EFFORT.deepseek_hybrid] as const
} as const

export const getThinkModelType = (model: Model): ThinkingModelType => {
  let thinkingModelType: ThinkingModelType = 'default'
  if (isGPT5SeriesModel(model)) {
    thinkingModelType = 'gpt5'
  } else if (isSupportedReasoningEffortOpenAIModel(model)) {
    thinkingModelType = 'o'
  } else if (isSupportedThinkingTokenGeminiModel(model)) {
    if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
      thinkingModelType = 'gemini'
    } else {
      thinkingModelType = 'gemini_pro'
    }
  } else if (isSupportedReasoningEffortGrokModel(model)) thinkingModelType = 'grok'
  else if (isSupportedThinkingTokenQwenModel(model)) {
    if (isQwenAlwaysThinkModel(model)) {
      thinkingModelType = 'qwen_thinking'
    }
    thinkingModelType = 'qwen'
  } else if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (isDoubaoThinkingAutoModel(model)) {
      thinkingModelType = 'doubao'
    } else {
      thinkingModelType = 'doubao_no_auto'
    }
  } else if (isSupportedThinkingTokenHunyuanModel(model)) thinkingModelType = 'hunyuan'
  else if (isSupportedReasoningEffortPerplexityModel(model)) thinkingModelType = 'perplexity'
  else if (isSupportedThinkingTokenZhipuModel(model)) thinkingModelType = 'zhipu'
  else if (isDeepSeekHybridInferenceModel(model)) thinkingModelType = 'deepseek_hybrid'
  return thinkingModelType
}

export function isFunctionCallingModel(model?: Model): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
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

// For middleware to identify models that must use the dedicated Image API
export const DEDICATED_IMAGE_MODELS = [
  'grok-2-image',
  'grok-2-image-1212',
  'grok-2-image-latest',
  'dall-e-3',
  'dall-e-2',
  'gpt-image-1'
]

// Models that should auto-enable image generation button when selected
export const AUTO_ENABLE_IMAGE_MODELS = ['gemini-2.5-flash-image-preview', ...DEDICATED_IMAGE_MODELS]

export const OPENAI_IMAGE_GENERATION_MODELS = [
  'o3',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5',
  'gpt-image-1'
]

export const GENERATE_IMAGE_MODELS = [
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.5-flash-image-preview',
  ...DEDICATED_IMAGE_MODELS
]

export const isDedicatedImageGenerationModel = (model: Model): boolean => {
  if (!model) return false

  const modelId = getLowerBaseModelName(model.id)
  return DEDICATED_IMAGE_MODELS.some((m) => modelId.includes(m))
}

export const isAutoEnableImageGenerationModel = (model: Model): boolean => {
  if (!model) return false

  const modelId = getLowerBaseModelName(model.id)
  return AUTO_ENABLE_IMAGE_MODELS.some((m) => modelId.includes(m))
}

export function isGenerateImageModel(model: Model): boolean {
  if (!model) {
    return false
  }

  const provider = getProviderByModel(model)

  if (!provider) {
    return false
  }

  if (isEmbeddingModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  if (provider.type === 'openai-response') {
    return (
      OPENAI_IMAGE_GENERATION_MODELS.some((imageModel) => modelId.includes(imageModel)) ||
      GENERATE_IMAGE_MODELS.some((imageModel) => modelId.includes(imageModel))
    )
  }

  return GENERATE_IMAGE_MODELS.some((imageModel) => modelId.includes(imageModel))
}

export const GEMINI_SEARCH_REGEX = new RegExp('gemini-2\\..*', 'i')

export const OPENAI_NO_SUPPORT_DEV_ROLE_MODELS = ['o1-preview', 'o1-mini']

export const PERPLEXITY_SEARCH_MODELS = [
  'sonar-pro',
  'sonar',
  'sonar-reasoning',
  'sonar-reasoning-pro',
  'sonar-deep-research'
]

export function isTextToImageModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return TEXT_TO_IMAGE_REGEX.test(modelId)
}

export function isEmbeddingModel(model: Model): boolean {
  if (!model || isRerankModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (isUserSelectedModelType(model, 'embedding') !== undefined) {
    return isUserSelectedModelType(model, 'embedding')!
  }

  if (['anthropic'].includes(model?.provider)) {
    return false
  }

  if (model.provider === 'doubao' || modelId.includes('doubao')) {
    return EMBEDDING_REGEX.test(model.name)
  }

  return EMBEDDING_REGEX.test(modelId) || false
}

export function isRerankModel(model: Model): boolean {
  if (isUserSelectedModelType(model, 'rerank') !== undefined) {
    return isUserSelectedModelType(model, 'rerank')!
  }
  const modelId = getLowerBaseModelName(model.id)
  return model ? RERANKING_REGEX.test(modelId) || false : false
}

export function isVisionModel(model: Model): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model)) {
    return false
  }
  // 新添字段 copilot-vision-request 后可使用 vision
  // if (model.provider === 'copilot') {
  //   return false
  // }
  if (isUserSelectedModelType(model, 'vision') !== undefined) {
    return isUserSelectedModelType(model, 'vision')!
  }

  const modelId = getLowerBaseModelName(model.id)
  if (model.provider === 'doubao' || modelId.includes('doubao')) {
    return VISION_REGEX.test(model.name) || VISION_REGEX.test(modelId) || false
  }

  return VISION_REGEX.test(modelId) || false
}

export function isOpenAIReasoningModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id, '/')
  return isSupportedReasoningEffortOpenAIModel(model) || modelId.includes('o1')
}

export function isOpenAILLMModel(model: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)

  if (modelId.includes('gpt-4o-image')) {
    return false
  }
  if (isOpenAIReasoningModel(model)) {
    return true
  }
  if (modelId.includes('gpt')) {
    return true
  }
  return false
}

export function isOpenAIModel(model: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)

  return modelId.includes('gpt') || isOpenAIReasoningModel(model)
}

export function isSupportFlexServiceTierModel(model: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)
  return (
    (modelId.includes('o3') && !modelId.includes('o3-mini')) || modelId.includes('o4-mini') || modelId.includes('gpt-5')
  )
}
export function isSupportedFlexServiceTier(model: Model): boolean {
  return isSupportFlexServiceTierModel(model)
}

export function isSupportVerbosityModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return isGPT5SeriesModel(model) && !modelId.includes('chat')
}

export function isSupportedReasoningEffortOpenAIModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return (
    (modelId.includes('o1') && !(modelId.includes('o1-preview') || modelId.includes('o1-mini'))) ||
    modelId.includes('o3') ||
    modelId.includes('o4') ||
    modelId.includes('gpt-oss') ||
    (isGPT5SeriesModel(model) && !modelId.includes('chat'))
  )
}

export function isOpenAIChatCompletionOnlyModel(model: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return (
    modelId.includes('gpt-4o-search-preview') ||
    modelId.includes('gpt-4o-mini-search-preview') ||
    modelId.includes('o1-mini') ||
    modelId.includes('o1-preview')
  )
}

export function isOpenAIWebSearchChatCompletionOnlyModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-4o-search-preview') || modelId.includes('gpt-4o-mini-search-preview')
}

export function isOpenAIWebSearchModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)

  return (
    modelId.includes('gpt-4o-search-preview') ||
    modelId.includes('gpt-4o-mini-search-preview') ||
    (modelId.includes('gpt-4.1') && !modelId.includes('gpt-4.1-nano')) ||
    (modelId.includes('gpt-4o') && !modelId.includes('gpt-4o-image')) ||
    modelId.includes('o3') ||
    modelId.includes('o4') ||
    (modelId.includes('gpt-5') && !modelId.includes('chat'))
  )
}

/** 用于判断是否支持控制思考，但不一定以reasoning_effort的方式 */
export function isSupportedThinkingTokenModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  // Specifically for DeepSeek V3.1. White list for now
  if (isDeepSeekHybridInferenceModel(model)) {
    return (
      ['openrouter', 'dashscope', 'modelscope', 'doubao', 'silicon', 'nvidia', 'ppio'] satisfies SystemProviderId[]
    ).some((id) => id === model.provider)
  }

  return (
    isSupportedThinkingTokenGeminiModel(model) ||
    isSupportedThinkingTokenQwenModel(model) ||
    isSupportedThinkingTokenClaudeModel(model) ||
    isSupportedThinkingTokenDoubaoModel(model) ||
    isSupportedThinkingTokenHunyuanModel(model) ||
    isSupportedThinkingTokenZhipuModel(model)
  )
}

export function isSupportedReasoningEffortModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  return (
    isSupportedReasoningEffortOpenAIModel(model) ||
    isSupportedReasoningEffortGrokModel(model) ||
    isSupportedReasoningEffortPerplexityModel(model)
  )
}

export function isGrokModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('grok')
}

export function isSupportedReasoningEffortGrokModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  if (modelId.includes('grok-3-mini')) {
    return true
  }

  return false
}

export function isGrokReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)
  if (isSupportedReasoningEffortGrokModel(model) || modelId.includes('grok-4')) {
    return true
  }

  return false
}

export function isGeminiReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  if (modelId.startsWith('gemini') && modelId.includes('thinking')) {
    return true
  }

  if (isSupportedThinkingTokenGeminiModel(model)) {
    return true
  }

  return false
}

export const isSupportedThinkingTokenGeminiModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  if (modelId.includes('gemini-2.5')) {
    if (modelId.includes('image') || modelId.includes('tts')) {
      return false
    }
    return true
  } else {
    return false
  }
}

/** 是否为Qwen推理模型 */
export function isQwenReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  if (modelId.startsWith('qwen3')) {
    if (modelId.includes('thinking')) {
      return true
    }
  }

  if (isSupportedThinkingTokenQwenModel(model)) {
    return true
  }

  if (modelId.includes('qwq') || modelId.includes('qvq')) {
    return true
  }

  return false
}

/** 是否为支持思考控制的Qwen3推理模型 */
export function isSupportedThinkingTokenQwenModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  if (modelId.includes('coder')) {
    return false
  }

  if (modelId.startsWith('qwen3')) {
    // instruct 是非思考模型 thinking 是思考模型，二者都不能控制思考
    if (modelId.includes('instruct') || modelId.includes('thinking') || modelId.includes('qwen3-max')) {
      return false
    }
    return true
  }

  return [
    'qwen-plus',
    'qwen-plus-latest',
    'qwen-plus-0428',
    'qwen-plus-2025-04-28',
    'qwen-plus-0714',
    'qwen-plus-2025-07-14',
    'qwen-turbo',
    'qwen-turbo-latest',
    'qwen-turbo-0428',
    'qwen-turbo-2025-04-28',
    'qwen-turbo-0715',
    'qwen-turbo-2025-07-15',
    'qwen-flash',
    'qwen-flash-2025-07-28'
  ].includes(modelId)
}

/** 是否为不支持思考控制的Qwen推理模型 */
export function isQwenAlwaysThinkModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.startsWith('qwen3') && modelId.includes('thinking')
}

export function isSupportedThinkingTokenDoubaoModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  return DOUBAO_THINKING_MODEL_REGEX.test(modelId) || DOUBAO_THINKING_MODEL_REGEX.test(model.name)
}

export function isClaudeReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    modelId.includes('claude-3-7-sonnet') ||
    modelId.includes('claude-3.7-sonnet') ||
    modelId.includes('claude-sonnet-4') ||
    modelId.includes('claude-opus-4')
  )
}

export const isSupportedThinkingTokenClaudeModel = isClaudeReasoningModel

export const isSupportedThinkingTokenHunyuanModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('hunyuan-a13b')
}

export const isHunyuanReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')

  return isSupportedThinkingTokenHunyuanModel(model) || modelId.includes('hunyuan-t1')
}

export const isPerplexityReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return isSupportedReasoningEffortPerplexityModel(model) || modelId.includes('reasoning')
}

export const isSupportedReasoningEffortPerplexityModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('sonar-deep-research')
}

export const isSupportedThinkingTokenZhipuModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('glm-4.5')
}

export const isDeepSeekHybridInferenceModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  // deepseek官方使用chat和reasoner做推理控制，其他provider需要单独判断，id可能会有所差别
  // openrouter: deepseek/deepseek-chat-v3.1 不知道会不会有其他provider仿照ds官方分出一个同id的作为非思考模式的模型，这里有风险
  return /deepseek-v3(?:\.1|-1-\d+)?/.test(modelId) || modelId.includes('deepseek-chat-v3.1')
}

export const isSupportedThinkingTokenDeepSeekModel = isDeepSeekHybridInferenceModel

export const isZhipuReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return isSupportedThinkingTokenZhipuModel(model) || modelId.includes('glm-z1')
}

export const isStepReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('step-3') || modelId.includes('step-r1-v-mini')
}

export function isReasoningModel(model?: Model): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
    return false
  }

  if (isUserSelectedModelType(model, 'reasoning') !== undefined) {
    return isUserSelectedModelType(model, 'reasoning')!
  }

  const modelId = getLowerBaseModelName(model.id)

  if (model.provider === 'doubao' || modelId.includes('doubao')) {
    return (
      REASONING_REGEX.test(modelId) ||
      REASONING_REGEX.test(model.name) ||
      isSupportedThinkingTokenDoubaoModel(model) ||
      isDeepSeekHybridInferenceModel(model) ||
      isDeepSeekHybridInferenceModel({ ...model, id: model.name }) ||
      false
    )
  }

  if (
    isClaudeReasoningModel(model) ||
    isOpenAIReasoningModel(model) ||
    isGeminiReasoningModel(model) ||
    isQwenReasoningModel(model) ||
    isGrokReasoningModel(model) ||
    isHunyuanReasoningModel(model) ||
    isPerplexityReasoningModel(model) ||
    isZhipuReasoningModel(model) ||
    isStepReasoningModel(model) ||
    isDeepSeekHybridInferenceModel(model) ||
    modelId.includes('magistral') ||
    modelId.includes('minimax-m1') ||
    modelId.includes('pangu-pro-moe')
  ) {
    return true
  }

  return REASONING_REGEX.test(modelId) || false
}

export function isSupportedModel(model: OpenAI.Models.Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  return !NOT_SUPPORTED_REGEX.test(modelId)
}

export function isNotSupportTemperatureAndTopP(model: Model): boolean {
  if (!model) {
    return true
  }

  if (
    (isOpenAIReasoningModel(model) && !isOpenAIOpenWeightModel(model)) ||
    isOpenAIChatCompletionOnlyModel(model) ||
    isQwenMTModel(model)
  ) {
    return true
  }

  return false
}

export function isWebSearchModel(model: Model): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
    return false
  }

  if (isUserSelectedModelType(model, 'web_search') !== undefined) {
    return isUserSelectedModelType(model, 'web_search')!
  }

  const provider = getProviderByModel(model)

  if (!provider) {
    return false
  }

  const isEmbedding = isEmbeddingModel(model)

  if (isEmbedding) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  // 不管哪个供应商都判断了
  if (isAnthropicModel(model)) {
    return CLAUDE_SUPPORTED_WEBSEARCH_REGEX.test(modelId)
  }

  if (provider.type === 'openai-response') {
    if (isOpenAIWebSearchModel(model)) {
      return true
    }

    return false
  }

  if (provider.id === 'perplexity') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  if (provider.id === 'aihubmix') {
    // modelId 不以-search结尾
    if (!modelId.endsWith('-search') && GEMINI_SEARCH_REGEX.test(modelId)) {
      return true
    }

    if (isOpenAIWebSearchModel(model)) {
      return true
    }

    return false
  }

  if (provider?.type === 'openai') {
    if (GEMINI_SEARCH_REGEX.test(modelId) || isOpenAIWebSearchModel(model)) {
      return true
    }
  }

  if (provider.id === 'gemini' || provider?.type === 'gemini' || provider.type === 'vertexai') {
    return GEMINI_SEARCH_REGEX.test(modelId)
  }

  if (provider.id === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  if (provider.id === 'zhipu') {
    return modelId?.startsWith('glm-4-')
  }

  if (provider.id === 'dashscope') {
    const models = ['qwen-turbo', 'qwen-max', 'qwen-plus', 'qwq', 'qwen-flash']
    // matches id like qwen-max-0919, qwen-max-latest
    return models.some((i) => modelId.startsWith(i))
  }

  if (provider.id === 'openrouter') {
    return true
  }

  if (provider.id === 'grok') {
    return true
  }

  return false
}

export function isMandatoryWebSearchModel(model: Model): boolean {
  if (!model) {
    return false
  }

  const provider = getProviderByModel(model)

  if (!provider) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (provider.id === 'perplexity' || provider.id === 'openrouter') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  return false
}

export function isOpenRouterBuiltInWebSearchModel(model: Model): boolean {
  if (!model) {
    return false
  }

  const provider = getProviderByModel(model)

  if (provider.id !== 'openrouter') {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  return isOpenAIWebSearchChatCompletionOnlyModel(model) || modelId.includes('sonar')
}

export function isNotSupportedImageSizeModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const baseName = getLowerBaseModelName(model.id, '/')

  return baseName.includes('grok-2-image')
}

export function getOpenAIWebSearchParams(model: Model, isEnableWebSearch?: boolean): Record<string, any> {
  if (!isEnableWebSearch) {
    return {}
  }

  const webSearchTools = getWebSearchTools(model)

  if (model.provider === 'grok') {
    return {
      search_parameters: {
        mode: 'auto',
        return_citations: true,
        sources: [{ type: 'web' }, { type: 'x' }, { type: 'news' }]
      }
    }
  }

  if (model.provider === 'hunyuan') {
    return { enable_enhancement: true, citation: true, search_info: true }
  }

  if (model.provider === 'dashscope') {
    return {
      enable_search: true,
      search_options: {
        forced_search: true
      }
    }
  }

  if (isOpenAIWebSearchChatCompletionOnlyModel(model)) {
    return {
      web_search_options: {}
    }
  }

  if (model.provider === 'openrouter') {
    return {
      plugins: [{ id: 'web', search_prompts: WEB_SEARCH_PROMPT_FOR_OPENROUTER }]
    }
  }

  return {
    tools: webSearchTools
  }
}

export function isGemmaModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gemma-') || model.group === 'Gemma'
}

export function isZhipuModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  return model.provider === 'zhipu'
}

export function isHunyuanSearchModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (model.provider === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  return false
}

/**
 * 按 Qwen 系列模型分组
 * @param models 模型列表
 * @returns 分组后的模型
 */
export function groupQwenModels(models: Model[]): Record<string, Model[]> {
  return models.reduce(
    (groups, model) => {
      const modelId = getLowerBaseModelName(model.id)
      // 匹配 Qwen 系列模型的前缀
      const prefixMatch = modelId.match(/^(qwen(?:\d+\.\d+|2(?:\.\d+)?|-\d+b|-(?:max|coder|vl)))/i)
      // 匹配 qwen2.5、qwen2、qwen-7b、qwen-max、qwen-coder 等
      const groupKey = prefixMatch ? prefixMatch[1] : model.group || '其他'

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(model)

      return groups
    },
    {} as Record<string, Model[]>
  )
}

export const THINKING_TOKEN_MAP: Record<string, { min: number; max: number }> = {
  // Gemini models
  'gemini-2\\.5-flash-lite.*$': { min: 512, max: 24576 },
  'gemini-.*-flash.*$': { min: 0, max: 24576 },
  'gemini-.*-pro.*$': { min: 128, max: 32768 },

  // Qwen models
  'qwen3-235b-a22b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen3-30b-a3b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen-plus-2025-07-28$': { min: 0, max: 81_920 },
  'qwen-plus-latest$': { min: 0, max: 81_920 },
  'qwen3-1\\.7b$': { min: 0, max: 30_720 },
  'qwen3-0\\.6b$': { min: 0, max: 30_720 },
  'qwen-plus.*$': { min: 0, max: 38_912 },
  'qwen-turbo.*$': { min: 0, max: 38_912 },
  'qwen-flash.*$': { min: 0, max: 81_920 },
  'qwen3-.*$': { min: 1024, max: 38_912 },

  // Claude models
  'claude-3[.-]7.*sonnet.*$': { min: 1024, max: 64000 },
  'claude-(:?sonnet|opus)-4.*$': { min: 1024, max: 32000 }
}

export const findTokenLimit = (modelId: string): { min: number; max: number } | undefined => {
  for (const [pattern, limits] of Object.entries(THINKING_TOKEN_MAP)) {
    if (new RegExp(pattern, 'i').test(modelId)) {
      return limits
    }
  }
  return undefined
}

// Doubao 支持思考模式的模型正则
export const DOUBAO_THINKING_MODEL_REGEX =
  /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-]6(?:-flash)?(?!-(?:thinking)(?:-|$)))(?:-[\w-]+)*/i

// 支持 auto 的 Doubao 模型 doubao-seed-1.6-xxx doubao-seed-1-6-xxx  doubao-1-5-thinking-pro-m-xxx
export const DOUBAO_THINKING_AUTO_MODEL_REGEX =
  /doubao-(1-5-thinking-pro-m|seed-1[.-]6)(?!-(?:flash|thinking)(?:-|$))(?:-[\w-]+)*/i

export function isDoubaoThinkingAutoModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return DOUBAO_THINKING_AUTO_MODEL_REGEX.test(modelId) || DOUBAO_THINKING_AUTO_MODEL_REGEX.test(model.name)
}

export const GEMINI_FLASH_MODEL_REGEX = new RegExp('gemini-.*-flash.*$')

// 模型集合功能测试
export const isVisionModels = (models: Model[]) => {
  return models.every((model) => isVisionModel(model))
}

export const isGenerateImageModels = (models: Model[]) => {
  return models.every((model) => isGenerateImageModel(model))
}

export const isAnthropicModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return modelId.startsWith('claude')
}

export const isQwenMTModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('qwen-mt')
}

export const isNotSupportedTextDelta = (model: Model): boolean => {
  return isQwenMTModel(model)
}

export const isNotSupportSystemMessageModel = (model: Model): boolean => {
  return isQwenMTModel(model) || isGemmaModel(model)
}

export const isGPT5SeriesModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-5')
}

export const isGeminiModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gemini')
}

export const isOpenAIOpenWeightModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-oss')
}

// zhipu 视觉推理模型用这组 special token 标记推理结果
export const ZHIPU_RESULT_TOKENS = ['<|begin_of_box|>', '<|end_of_box|>'] as const
