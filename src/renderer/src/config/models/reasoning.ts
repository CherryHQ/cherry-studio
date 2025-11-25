import type {
  Model,
  ReasoningEffortConfig,
  SystemProviderId,
  ThinkingModelType,
  ThinkingOptionConfig
} from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

import { isEmbeddingModel, isRerankModel } from './embedding'
import {
  isGPT5ProModel,
  isGPT5SeriesModel,
  isGPT51SeriesModel,
  isOpenAIDeepResearchModel,
  isOpenAIReasoningModel,
  isSupportedReasoningEffortOpenAIModel
} from './openai'
import { GEMINI_FLASH_MODEL_REGEX, isGemini3ThinkingTokenModel } from './utils'
import { isTextToImageModel } from './vision'

// Reasoning models
export const REASONING_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast)(?:-[\w-]+)?\b.*)$/i

// 模型类型到支持的reasoning_effort的映射表
// TODO: refactor this. too many identical options
export const MODEL_SUPPORTED_REASONING_EFFORT: ReasoningEffortConfig = {
  default: ['low', 'medium', 'high'] as const,
  o: ['low', 'medium', 'high'] as const,
  openai_deep_research: ['medium'] as const,
  gpt5: ['minimal', 'low', 'medium', 'high'] as const,
  gpt5_codex: ['low', 'medium', 'high'] as const,
  gpt5_1: ['none', 'low', 'medium', 'high'] as const,
  gpt5_1_codex: ['none', 'medium', 'high'] as const,
  gpt5pro: ['high'] as const,
  grok: ['low', 'high'] as const,
  grok4_fast: ['auto'] as const,
  gemini: ['low', 'medium', 'high', 'auto'] as const,
  gemini3: ['low', 'medium', 'high'] as const,
  gemini_pro: ['low', 'medium', 'high', 'auto'] as const,
  qwen: ['low', 'medium', 'high'] as const,
  qwen_thinking: ['low', 'medium', 'high'] as const,
  doubao: ['auto', 'high'] as const,
  doubao_no_auto: ['high'] as const,
  doubao_after_251015: ['minimal', 'low', 'medium', 'high'] as const,
  hunyuan: ['auto'] as const,
  zhipu: ['auto'] as const,
  perplexity: ['low', 'medium', 'high'] as const,
  deepseek_hybrid: ['auto'] as const
} as const

// 模型类型到支持选项的映射表
export const MODEL_SUPPORTED_OPTIONS: ThinkingOptionConfig = {
  default: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.default] as const,
  o: MODEL_SUPPORTED_REASONING_EFFORT.o,
  openai_deep_research: MODEL_SUPPORTED_REASONING_EFFORT.openai_deep_research,
  gpt5: [...MODEL_SUPPORTED_REASONING_EFFORT.gpt5] as const,
  gpt5pro: MODEL_SUPPORTED_REASONING_EFFORT.gpt5pro,
  gpt5_codex: MODEL_SUPPORTED_REASONING_EFFORT.gpt5_codex,
  gpt5_1: MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1,
  gpt5_1_codex: MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1_codex,
  grok: MODEL_SUPPORTED_REASONING_EFFORT.grok,
  grok4_fast: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.grok4_fast] as const,
  gemini: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini] as const,
  gemini_pro: MODEL_SUPPORTED_REASONING_EFFORT.gemini_pro,
  gemini3: MODEL_SUPPORTED_REASONING_EFFORT.gemini3,
  qwen: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.qwen] as const,
  qwen_thinking: MODEL_SUPPORTED_REASONING_EFFORT.qwen_thinking,
  doubao: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao] as const,
  doubao_no_auto: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao_no_auto] as const,
  doubao_after_251015: MODEL_SUPPORTED_REASONING_EFFORT.doubao_after_251015,
  hunyuan: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.hunyuan] as const,
  zhipu: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.zhipu] as const,
  perplexity: MODEL_SUPPORTED_REASONING_EFFORT.perplexity,
  deepseek_hybrid: ['none', ...MODEL_SUPPORTED_REASONING_EFFORT.deepseek_hybrid] as const
} as const

const withModelIdAndNameAsId = <T>(model: Model, fn: (model: Model) => T): { idResult: T; nameResult: T } => {
  const modelWithNameAsId = { ...model, id: model.name }
  return {
    idResult: fn(model),
    nameResult: fn(modelWithNameAsId)
  }
}

const _getThinkModelType = (model: Model): ThinkingModelType => {
  let thinkingModelType: ThinkingModelType = 'default'
  const modelId = getLowerBaseModelName(model.id)
  if (isOpenAIDeepResearchModel(model)) {
    return 'openai_deep_research'
  }
  if (isGPT51SeriesModel(model)) {
    if (modelId.includes('codex')) {
      thinkingModelType = 'gpt5_1_codex'
    } else {
      thinkingModelType = 'gpt5_1'
    }
  } else if (isGPT5SeriesModel(model)) {
    if (modelId.includes('codex')) {
      thinkingModelType = 'gpt5_codex'
    } else {
      thinkingModelType = 'gpt5'
      if (isGPT5ProModel(model)) {
        thinkingModelType = 'gpt5pro'
      }
    }
  } else if (isSupportedReasoningEffortOpenAIModel(model)) {
    thinkingModelType = 'o'
  } else if (isGrok4FastReasoningModel(model)) {
    thinkingModelType = 'grok4_fast'
  } else if (isSupportedThinkingTokenGeminiModel(model)) {
    if (GEMINI_FLASH_MODEL_REGEX.test(model.id)) {
      thinkingModelType = 'gemini'
    } else {
      thinkingModelType = 'gemini_pro'
    }
    if (isGemini3ThinkingTokenModel(model)) {
      thinkingModelType = 'gemini3'
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
    } else if (isDoubaoSeedAfter251015(model)) {
      thinkingModelType = 'doubao_after_251015'
    } else {
      thinkingModelType = 'doubao_no_auto'
    }
  } else if (isSupportedThinkingTokenHunyuanModel(model)) thinkingModelType = 'hunyuan'
  else if (isSupportedReasoningEffortPerplexityModel(model)) thinkingModelType = 'perplexity'
  else if (isSupportedThinkingTokenZhipuModel(model)) thinkingModelType = 'zhipu'
  else if (isDeepSeekHybridInferenceModel(model)) thinkingModelType = 'deepseek_hybrid'
  return thinkingModelType
}

export const getThinkModelType = (model: Model): ThinkingModelType => {
  const { idResult, nameResult } = withModelIdAndNameAsId(model, _getThinkModelType)
  if (idResult !== 'default') {
    return idResult
  } else {
    return nameResult
  }
}

function _isSupportedThinkingTokenModel(model: Model): boolean {
  // Specifically for DeepSeek V3.1. White list for now
  if (isDeepSeekHybridInferenceModel(model)) {
    return (
      [
        'openrouter',
        'dashscope',
        'modelscope',
        'doubao',
        'silicon',
        'nvidia',
        'ppio',
        'hunyuan',
        'tencent-cloud-ti'
      ] satisfies SystemProviderId[]
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

/** 用于判断是否支持控制思考，但不一定以reasoning_effort的方式 */
export function isSupportedThinkingTokenModel(model?: Model): boolean {
  if (!model) return false
  const { idResult, nameResult } = withModelIdAndNameAsId(model, _isSupportedThinkingTokenModel)
  return idResult || nameResult
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

export function isSupportedReasoningEffortGrokModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  const providerId = model?.provider?.toLowerCase()
  if (modelId.includes('grok-3-mini')) {
    return true
  }

  if (providerId === 'openrouter' && modelId.includes('grok-4-fast')) {
    return true
  }

  return false
}

/**
 * Checks if the model is Grok 4 Fast reasoning version
 * Explicitly excludes non-reasoning variants (models with 'non-reasoning' in their ID)
 *
 * Note: XAI official uses different model IDs for reasoning vs non-reasoning
 * Third-party providers like OpenRouter expose a single ID with reasoning parameters, while first-party providers require separate IDs. Only the OpenRouter variant supports toggling.
 *
 * @param model - The model to check
 * @returns true if the model is a reasoning-enabled Grok 4 Fast model
 */
export function isGrok4FastReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('grok-4-fast') && !modelId.includes('non-reasoning')
}

export function isGrokReasoningModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)
  if (
    isSupportedReasoningEffortGrokModel(model) ||
    (modelId.includes('grok-4') && !modelId.includes('non-reasoning'))
  ) {
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

// Gemini 支持思考模式的模型正则
export const GEMINI_THINKING_MODEL_REGEX =
  /gemini-(?:2\.5.*(?:-latest)?|3(?:\.\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\w-]+)*$/i

export const isSupportedThinkingTokenGeminiModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  if (GEMINI_THINKING_MODEL_REGEX.test(modelId)) {
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
    'qwen-plus-2025-07-28',
    'qwen-plus-2025-09-11',
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
  // 包括 qwen3 开头的 thinking 模型和 qwen3-vl 的 thinking 模型
  return (
    (modelId.startsWith('qwen3') && modelId.includes('thinking')) ||
    (modelId.includes('qwen3-vl') && modelId.includes('thinking'))
  )
}

// Doubao 支持思考模式的模型正则
export const DOUBAO_THINKING_MODEL_REGEX =
  /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-]6(?:-flash)?(?!-(?:thinking)(?:-|$)))(?:-[\w-]+)*/i

// 支持 auto 的 Doubao 模型 doubao-seed-1.6-xxx doubao-seed-1-6-xxx  doubao-1-5-thinking-pro-m-xxx
// Auto thinking is no longer supported after version 251015, see https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seed-1-6
export const DOUBAO_THINKING_AUTO_MODEL_REGEX =
  /doubao-(1-5-thinking-pro-m|seed-1[.-]6)(?!-(?:flash|thinking)(?:-|$))(?:-lite)?(?!-251015)(?:-\d+)?$/i

export function isDoubaoThinkingAutoModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return DOUBAO_THINKING_AUTO_MODEL_REGEX.test(modelId) || DOUBAO_THINKING_AUTO_MODEL_REGEX.test(model.name)
}

export function isDoubaoSeedAfter251015(model: Model): boolean {
  const pattern = new RegExp(/doubao-seed-1-6-(?:lite-)?251015/i)
  const result = pattern.test(model.id)
  return result
}

export function isSupportedThinkingTokenDoubaoModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  return DOUBAO_THINKING_MODEL_REGEX.test(modelId) || DOUBAO_THINKING_MODEL_REGEX.test(model.name)
}

export function isClaude45ReasoningModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id, '/')
  const regex = /claude-(sonnet|opus|haiku)-4(-|.)5(?:-[\w-]+)?$/i
  return regex.test(modelId)
}

export function isClaude4SeriesModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id, '/')
  const regex = /claude-(sonnet|opus|haiku)-4(?:[.-]\d+)?(?:-[\w-]+)?$/i
  return regex.test(modelId)
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
    modelId.includes('claude-opus-4') ||
    modelId.includes('claude-haiku-4')
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
  return (
    isSupportedReasoningEffortPerplexityModel(model) ||
    (modelId.includes('reasoning') && !modelId.includes('non-reasoning'))
  )
}

export const isSupportedReasoningEffortPerplexityModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('sonar-deep-research')
}

export const isSupportedThinkingTokenZhipuModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id, '/')
  return ['glm-4.5', 'glm-4.6'].some((id) => modelId.includes(id))
}

export const isDeepSeekHybridInferenceModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  // deepseek官方使用chat和reasoner做推理控制，其他provider需要单独判断，id可能会有所差别
  // openrouter: deepseek/deepseek-chat-v3.1 不知道会不会有其他provider仿照ds官方分出一个同id的作为非思考模式的模型，这里有风险
  // Matches: "deepseek-v3" followed by ".digit" or "-digit".
  // Optionally, this can be followed by ".alphanumeric_sequence" or "-alphanumeric_sequence"
  // until the end of the string.
  // Examples: deepseek-v3.1, deepseek-v3-1, deepseek-v3.1.2, deepseek-v3.1-alpha
  // Does NOT match: deepseek-v3.123 (missing separator after '1'), deepseek-v3.x (x isn't a digit)
  // TODO: move to utils and add test cases
  return /deepseek-v3(?:\.\d|-\d)(?:(\.|-)\w+)?$/.test(modelId) || modelId.includes('deepseek-chat-v3.1')
}

export const isLingReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return ['ring-1t', 'ring-mini', 'ring-flash'].some((id) => modelId.includes(id))
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

export const isMiniMaxReasoningModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id, '/')
  return (['minimax-m1', 'minimax-m2'] as const).some((id) => modelId.includes(id))
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
    isLingReasoningModel(model) ||
    isMiniMaxReasoningModel(model) ||
    modelId.includes('magistral') ||
    modelId.includes('pangu-pro-moe') ||
    modelId.includes('seed-oss')
  ) {
    return true
  }

  return REASONING_REGEX.test(modelId) || false
}

export const THINKING_TOKEN_MAP: Record<string, { min: number; max: number }> = {
  // Gemini models
  'gemini-2\\.5-flash-lite.*$': { min: 512, max: 24576 },
  'gemini-.*-flash.*$': { min: 0, max: 24576 },
  'gemini-.*-pro.*$': { min: 128, max: 32768 },

  // Qwen models
  // qwen-plus-x 系列自 qwen-plus-2025-07-28 后模型最长思维链变为 81_920, qwen-plus 模型于 2025.9.16 同步变更
  'qwen3-235b-a22b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen3-30b-a3b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen3-vl-235b-a22b-thinking$': { min: 0, max: 81_920 },
  'qwen3-vl-30b-a3b-thinking$': { min: 0, max: 81_920 },
  'qwen-plus-2025-07-14$': { min: 0, max: 38_912 },
  'qwen-plus-2025-04-28$': { min: 0, max: 38_912 },
  'qwen3-1\\.7b$': { min: 0, max: 30_720 },
  'qwen3-0\\.6b$': { min: 0, max: 30_720 },
  'qwen-plus.*$': { min: 0, max: 81_920 },
  'qwen-turbo.*$': { min: 0, max: 38_912 },
  'qwen-flash.*$': { min: 0, max: 81_920 },
  'qwen3-(?!max).*$': { min: 1024, max: 38_912 },

  // Claude models
  'claude-3[.-]7.*sonnet.*$': { min: 1024, max: 64_000 },
  'claude-(:?haiku|sonnet)-4.*$': { min: 1024, max: 64_000 },
  'claude-opus-4-1.*$': { min: 1024, max: 32_000 }
}

export const findTokenLimit = (modelId: string): { min: number; max: number } | undefined => {
  for (const [pattern, limits] of Object.entries(THINKING_TOKEN_MAP)) {
    if (new RegExp(pattern, 'i').test(modelId)) {
      return limits
    }
  }
  return undefined
}
