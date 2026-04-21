import { getLowerBaseModelName } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { getCapabilityState } from './shared'
import type { ProviderSettingsCapabilityModel } from './types'
import { isPureGenerateImageModel } from './vision'

const REASONING_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast)(?:-[\w-]+)?\b.*)$/i

const GEMINI_THINKING_MODEL_REGEX =
  /gemini-(?:2\.5.*(?:-latest)?|3(?:\.\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\w-]+)*$/i

const DOUBAO_THINKING_MODEL_REGEX =
  /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-(?:thinking)(?:-|$))|seed-code(?:-preview)?(?:-\d+)?|seed-2[.-]0(?:-[\w-]+)?)(?:-[\w-]+)*/i

type ModelIdLike = { id: string }

function withModelIdAndNameAsId<T extends Pick<Model, 'id' | 'name'>>(model: T, fn: (value: ModelIdLike) => boolean) {
  return fn(model) || fn({ id: model.name })
}

function isOpenAIReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return (
    (normalizedModelId.includes('o1') &&
      !(normalizedModelId.includes('o1-preview') || normalizedModelId.includes('o1-mini'))) ||
    normalizedModelId.includes('o3') ||
    normalizedModelId.includes('o4') ||
    normalizedModelId.includes('gpt-oss') ||
    (normalizedModelId.includes('gpt-5') && !normalizedModelId.includes('chat')) ||
    normalizedModelId.includes('o1')
  )
}

function isGeminiReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId)
  return (
    (normalizedModelId.startsWith('gemini') && normalizedModelId.includes('thinking')) ||
    isSupportedThinkingTokenGeminiModel(modelId)
  )
}

function isSupportedThinkingTokenGeminiModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  if (!GEMINI_THINKING_MODEL_REGEX.test(normalizedModelId)) {
    return false
  }
  if (normalizedModelId.includes('gemini-3-pro-image')) {
    return true
  }
  return !(normalizedModelId.includes('image') || normalizedModelId.includes('tts'))
}

function isQwenReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return (
    (normalizedModelId.startsWith('qwen3') && normalizedModelId.includes('thinking')) ||
    isSupportedThinkingTokenQwenModel(modelId) ||
    normalizedModelId.includes('qwq') ||
    normalizedModelId.includes('qvq')
  )
}

function isSupportedThinkingTokenQwenModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  if (
    ['coder', 'asr', 'tts', 'reranker', 'embedding', 'instruct', 'thinking'].some((field) =>
      normalizedModelId.includes(field)
    )
  ) {
    return false
  }

  return (
    /^qwen3\.[5-9]/.test(normalizedModelId) ||
    /^(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)/i.test(normalizedModelId) ||
    /^qwen(?:3\.[5-9])?-plus(?:-|$)/i.test(normalizedModelId) ||
    /^qwen(?:3\.[5-9])?-flash(?:-|$)/i.test(normalizedModelId) ||
    /^qwen(?:3\.[5-9])?-turbo(?:-|$)/i.test(normalizedModelId) ||
    /^qwen3-\d/i.test(normalizedModelId)
  )
}

function isQwenAlwaysThinkModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return (
    (normalizedModelId.startsWith('qwen3') && normalizedModelId.includes('thinking')) ||
    (normalizedModelId.includes('qwen3-vl') && normalizedModelId.includes('thinking'))
  )
}

function isGrokReasoningModel(model: Pick<Model, 'id' | 'providerId'>): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return (
    modelId.includes('grok-3-mini') ||
    (model.providerId === 'openrouter' && modelId.includes('grok-4-fast')) ||
    (modelId.includes('grok-4') && !modelId.includes('non-reasoning'))
  )
}

function isClaudeReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return (
    normalizedModelId.includes('claude-3-7-sonnet') ||
    normalizedModelId.includes('claude-3.7-sonnet') ||
    normalizedModelId.includes('claude-sonnet-4') ||
    normalizedModelId.includes('claude-opus-4') ||
    normalizedModelId.includes('claude-haiku-4')
  )
}

function isHunyuanReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return normalizedModelId.includes('hunyuan-a13b') || normalizedModelId.includes('hunyuan-t1')
}

function isPerplexityReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return (
    normalizedModelId.includes('sonar-deep-research') ||
    (normalizedModelId.includes('reasoning') && !normalizedModelId.includes('non-reasoning'))
  )
}

function isZhipuReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return /glm-?5|glm-4\.[567]/.test(normalizedModelId) || normalizedModelId.includes('glm-z1')
}

function isStepReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return normalizedModelId.includes('step-3') || normalizedModelId.includes('step-r1-v-mini')
}

export function isDeepSeekHybridInferenceModel(model: Pick<Model, 'id' | 'name'>): boolean {
  return withModelIdAndNameAsId(model, ({ id }) => {
    const modelId = getLowerBaseModelName(id)
    return (
      /(\w+-)?deepseek-v3(?:\.\d|-\d)(?:(\.|-)(?!speciale$)\w+)?$/.test(modelId) ||
      modelId.includes('deepseek-chat-v3.1') ||
      modelId.includes('deepseek-chat')
    )
  })
}

function isLingReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return ['ring-1t', 'ring-mini', 'ring-flash'].some((id) => normalizedModelId.includes(id))
}

function isMiniMaxReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return ['minimax-m1', 'minimax-m2', 'minimax-m2.1'].some((id) => normalizedModelId.includes(id))
}

function isMiMoReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return ['mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni'].some((id) => normalizedModelId.includes(id))
}

function isBaichuanReasoningModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId, '/')
  return normalizedModelId === 'baichuan-m2' || normalizedModelId === 'baichuan-m3'
}

function isKimiReasoningModel(model: Pick<Model, 'id' | 'name'>): boolean {
  return withModelIdAndNameAsId(model, ({ id }) =>
    /^kimi-k2-thinking(?:-turbo)?$|^kimi-k2\.5(?:-\w)*$/.test(getLowerBaseModelName(id, '/'))
  )
}

function isSupportedThinkingTokenDoubaoModel(model: Pick<Model, 'id' | 'name'>): boolean {
  return (
    DOUBAO_THINKING_MODEL_REGEX.test(getLowerBaseModelName(model.id, '/')) ||
    DOUBAO_THINKING_MODEL_REGEX.test(model.name)
  )
}

export function isReasoningModel(model?: ProviderSettingsCapabilityModel): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isPureGenerateImageModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'reasoning')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  if (model.providerId === 'doubao' || modelId.includes('doubao')) {
    return (
      REASONING_REGEX.test(modelId) ||
      REASONING_REGEX.test(model.name) ||
      isSupportedThinkingTokenDoubaoModel(model) ||
      isDeepSeekHybridInferenceModel(model)
    )
  }

  return (
    isClaudeReasoningModel(model.id) ||
    isOpenAIReasoningModel(model.id) ||
    isGeminiReasoningModel(model.id) ||
    isQwenReasoningModel(model.id) ||
    isGrokReasoningModel(model) ||
    isHunyuanReasoningModel(model.id) ||
    isPerplexityReasoningModel(model.id) ||
    isZhipuReasoningModel(model.id) ||
    isStepReasoningModel(model.id) ||
    isDeepSeekHybridInferenceModel(model) ||
    isLingReasoningModel(model.id) ||
    isMiniMaxReasoningModel(model.id) ||
    isMiMoReasoningModel(model.id) ||
    isBaichuanReasoningModel(model.id) ||
    isKimiReasoningModel(model) ||
    isQwenAlwaysThinkModel(model.id) ||
    modelId.includes('magistral') ||
    modelId.includes('pangu-pro-moe') ||
    modelId.includes('seed-oss') ||
    modelId.includes('deepseek-v3.2-speciale') ||
    modelId.includes('gemma-4') ||
    modelId.includes('gemma4') ||
    REASONING_REGEX.test(modelId)
  )
}
