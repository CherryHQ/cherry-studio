import type { CompoundIcon } from '@cherrystudio/ui'
import { resolveIcon, resolveModelIcon } from '@cherrystudio/ui/icons'
import { getLowerBaseModelName } from '@renderer/utils'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'

type LegacyModelCapability =
  | string
  | {
      type?: string
      isUserSelected?: boolean
    }

export type ProviderSettingsModel = Pick<Model, 'id' | 'name' | 'providerId'> &
  Partial<Pick<Model, 'group' | 'description' | 'endpointTypes' | 'capabilities'>> & {
    provider?: string
    endpoint_type?: string
    supported_endpoint_types?: string[]
    capabilities?: Model['capabilities'] | LegacyModelCapability[]
  }

type ModelTypeKey = 'vision' | 'reasoning' | 'function_calling' | 'web_search' | 'embedding' | 'rerank'

const CAPABILITY_BY_MODEL_TYPE: Record<ModelTypeKey, string> = {
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  rerank: MODEL_CAPABILITY.RERANK
}

const EMBEDDING_REGEX = /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i
const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i

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
] as const

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

const visionAllowedModels = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-3(?:\\.\\d)?-(?:flash|pro)(?:-preview)?',
  'gemini-(flash|pro|flash-lite)-latest',
  'gemini-exp',
  'claude-3',
  'claude-haiku-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3\\.[5-9](?:-[\\w-]+)?',
  'qwen2.5-omni',
  'qwen3-omni(?:-[\\w-]+)?',
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
  'kimi-k2.5',
  'kimi-latest',
  'gemma-?[3-4](?:[-.\\w]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-2[.-]0(?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  'gemma3(?:[-:\\w]+)?',
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?',
  'qwen-omni(?:-[\\w-]+)?',
  'mistral-large-(2512|latest)',
  'mistral-medium-(2508|latest)',
  'mistral-small-(2506|latest)',
  'mimo-v2-omni(?:-[\\w-]+)?',
  'glm-5v-turbo'
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

const VISION_REGEX = new RegExp(
  `\\b(?!(?:${visionExcludedModels.join('|')})\\b)(${visionAllowedModels.join('|')})\\b`,
  'i'
)

const DEDICATED_IMAGE_MODELS = [
  'dall-e(?:-[\\w-]+)?',
  'gpt-image(?:-[\\w-]+)?',
  'grok-2-image(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'flux(?:-[\\w-]+)?',
  'stable-?diffusion(?:-[\\w-]+)?',
  'stabilityai(?:-[\\w-]+)?',
  'sd-[\\w-]+',
  'sdxl(?:-[\\w-]+)?',
  'cogview(?:-[\\w-]+)?',
  'qwen-image(?:-[\\w-]+)?',
  'janus(?:-[\\w-]+)?',
  'midjourney(?:-[\\w-]+)?',
  'mj-[\\w-]+',
  'z-image(?:-[\\w-]+)?',
  'longcat-image(?:-[\\w-]+)?',
  'hunyuanimage(?:-[\\w-]+)?',
  'seedream(?:-[\\w-]+)?',
  'kandinsky(?:-[\\w-]+)?'
]

const IMAGE_ENHANCEMENT_MODELS = [
  'grok-2-image(?:-[\\w-]+)?',
  'qwen-image-edit',
  'gpt-image-1',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?'
]

const IMAGE_ENHANCEMENT_MODELS_REGEX = new RegExp(IMAGE_ENHANCEMENT_MODELS.join('|'), 'i')
const DEDICATED_IMAGE_MODEL_REGEX = new RegExp(DEDICATED_IMAGE_MODELS.join('|'), 'i')

const CLAUDE_SUPPORTED_WEBSEARCH_REGEX = new RegExp(
  `\\b(?:claude-3(-|\\.)(7|5)-sonnet(?:-[\\w-]+)|claude-3(-|\\.)5-haiku(?:-[\\w-]+)|claude-(haiku|sonnet|opus)-4(?:-[\\w-]+)?)\\b`,
  'i'
)

const GEMINI_SEARCH_REGEX = new RegExp(
  'gemini-(?:2(?!.*-image-preview).*(?:-latest)?|3(?:\\.\\d+)?-(?:flash|pro)(?:-(?:image-)?preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\\w-]+)*$',
  'i'
)

const PERPLEXITY_SEARCH_MODELS = ['sonar-pro', 'sonar', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research']

const NEW_API_PROVIDER_IDS = ['new-api', 'cherryin', 'aionly']

const REASONING_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast)(?:-[\w-]+)?\b.*)$/i

const GEMINI_THINKING_MODEL_REGEX =
  /gemini-(?:2\.5.*(?:-latest)?|3(?:\.\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\w-]+)*$/i

const DOUBAO_THINKING_MODEL_REGEX =
  /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-(?:thinking)(?:-|$))|seed-code(?:-preview)?(?:-\d+)?|seed-2[.-]0(?:-[\w-]+)?)(?:-[\w-]+)*/i

function getProviderId(model: ProviderSettingsModel): string | undefined {
  return model.providerId || model.provider
}

function getEndpointTypes(model: ProviderSettingsModel): string[] {
  if (Array.isArray(model.endpointTypes)) {
    return model.endpointTypes
  }
  if (Array.isArray(model.supported_endpoint_types)) {
    return model.supported_endpoint_types
  }
  if (model.endpoint_type) {
    return [model.endpoint_type]
  }
  return []
}

function hasEndpointType(model: ProviderSettingsModel, endpointType: string): boolean {
  return getEndpointTypes(model).includes(endpointType)
}

function getCapabilityState(model: ProviderSettingsModel, type: ModelTypeKey): boolean | undefined {
  const capabilities = model.capabilities as LegacyModelCapability[] | undefined
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return undefined
  }

  if (typeof capabilities[0] === 'string') {
    return capabilities.includes(CAPABILITY_BY_MODEL_TYPE[type])
  }

  const capability = capabilities.find(
    (item): item is Extract<LegacyModelCapability, { type?: string }> =>
      typeof item === 'object' && item !== null && 'type' in item && item.type === type
  )

  return capability ? capability.isUserSelected : undefined
}

function isAnthropicModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  return getLowerBaseModelName(model.id).startsWith('claude')
}

function isOpenAIWebSearchModel(model: ProviderSettingsModel): boolean {
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

function isClaude4SeriesModel(model: ProviderSettingsModel): boolean {
  return /claude-(sonnet|opus|haiku)-4(?:[.-]\d+)?(?:[@\-:][\w\-:]+)?$/i.test(getLowerBaseModelName(model.id, '/'))
}

function isSupportedThinkingTokenGeminiModel(model: ProviderSettingsModel): boolean {
  const modelId = getLowerBaseModelName(model.id, '/')
  if (!GEMINI_THINKING_MODEL_REGEX.test(modelId)) {
    return false
  }

  if (modelId.includes('gemini-3-pro-image')) {
    return true
  }

  return !(modelId.includes('image') || modelId.includes('tts'))
}

function isSupportedThinkingTokenQwenModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  if (
    ['coder', 'asr', 'tts', 'reranker', 'embedding', 'instruct', 'thinking'].some((field) => modelId.includes(field))
  ) {
    return false
  }

  if (/^qwen3\.[5-9]/.test(modelId)) {
    return true
  }

  return (
    /^(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)/i.test(modelId) ||
    /^qwen(?:3\.[5-9])?-plus(?:-|$)/i.test(modelId) ||
    /^qwen(?:3\.[5-9])?-flash(?:-|$)/i.test(modelId) ||
    /^qwen(?:3\.[5-9])?-turbo(?:-|$)/i.test(modelId) ||
    /^qwen3-\d/i.test(modelId)
  )
}

function isQwenAlwaysThinkModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    (modelId.startsWith('qwen3') && modelId.includes('thinking')) ||
    (modelId.includes('qwen3-vl') && modelId.includes('thinking'))
  )
}

function isSupportedThinkingTokenDoubaoModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return DOUBAO_THINKING_MODEL_REGEX.test(modelId) || DOUBAO_THINKING_MODEL_REGEX.test(model.name)
}

function isGrok4FastReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('grok-4-fast') && !modelId.includes('non-reasoning')
}

function isSupportedReasoningEffortGrokModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  const providerId = getProviderId(model)?.toLowerCase()

  return modelId.includes('grok-3-mini') || (providerId === 'openrouter' && modelId.includes('grok-4-fast'))
}

function isDeepSeekHybridInferenceModel(model: ProviderSettingsModel): boolean {
  const byId = getLowerBaseModelName(model.id)
  const byName = getLowerBaseModelName(model.name)
  const matcher = (value: string) =>
    /(\w+-)?deepseek-v3(?:\.\d|-\d)(?:(\.|-)(?!speciale$)\w+)?$/.test(value) ||
    value.includes('deepseek-chat-v3.1') ||
    value.includes('deepseek-chat')

  return matcher(byId) || matcher(byName)
}

function isClaudeReasoningModel(model?: ProviderSettingsModel): boolean {
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

function isOpenAIReasoningModel(model: ProviderSettingsModel): boolean {
  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    (modelId.includes('o1') && !(modelId.includes('o1-preview') || modelId.includes('o1-mini'))) ||
    modelId.includes('o3') ||
    modelId.includes('o4') ||
    modelId.includes('gpt-oss') ||
    (modelId.includes('gpt-5') && !modelId.includes('chat')) ||
    modelId.includes('o1')
  )
}

function isGeminiReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return (modelId.startsWith('gemini') && modelId.includes('thinking')) || isSupportedThinkingTokenGeminiModel(model)
}

function isQwenReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    (modelId.startsWith('qwen3') && modelId.includes('thinking')) ||
    isSupportedThinkingTokenQwenModel(model) ||
    modelId.includes('qwq') ||
    modelId.includes('qvq')
  )
}

function isGrokReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return (
    isSupportedReasoningEffortGrokModel(model) || (modelId.includes('grok-4') && !modelId.includes('non-reasoning'))
  )
}

function isHunyuanReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('hunyuan-a13b') || modelId.includes('hunyuan-t1')
}

function isPerplexityReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return (
    modelId.includes('sonar-deep-research') || (modelId.includes('reasoning') && !modelId.includes('non-reasoning'))
  )
}

function isZhipuReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return /glm-?5|glm-4\.[567]/.test(modelId) || modelId.includes('glm-z1')
}

function isStepReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId.includes('step-3') || modelId.includes('step-r1-v-mini')
}

function isLingReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return ['ring-1t', 'ring-mini', 'ring-flash'].some((id) => modelId.includes(id))
}

function isMiniMaxReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return ['minimax-m1', 'minimax-m2', 'minimax-m2.1'].some((id) => modelId.includes(id))
}

function isMiMoReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return ['mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni'].some((id) => modelId.includes(id))
}

function isBaichuanReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return modelId === 'baichuan-m2' || modelId === 'baichuan-m3'
}

function isKimiReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model) {
    return false
  }

  const matcher = (value: string) => /^kimi-k2-thinking(?:-turbo)?$|^kimi-k2\.5(?:-\w)*$/.test(value)
  return matcher(getLowerBaseModelName(model.id, '/')) || matcher(getLowerBaseModelName(model.name, '/'))
}

function isTextToImageModel(model: ProviderSettingsModel): boolean {
  return isDedicatedImageModel(model)
}

export type { CompoundIcon }

export function getModelLogoById(modelId: string): CompoundIcon | undefined {
  return resolveModelIcon(modelId)
}

export function getModelLogo(
  model: ProviderSettingsModel | undefined | null,
  providerId?: string
): CompoundIcon | undefined {
  if (!model) return undefined

  const resolvedProviderId = providerId ?? getProviderId(model)
  if (resolvedProviderId) {
    return resolveIcon(model.id, resolvedProviderId) ?? resolveIcon(model.name, resolvedProviderId)
  }

  return resolveModelIcon(model.id) ?? resolveModelIcon(model.name)
}

export function groupQwenModels(models: ProviderSettingsModel[]): Record<string, ProviderSettingsModel[]> {
  return models.reduce(
    (groups, model) => {
      const modelId = getLowerBaseModelName(model.id)
      const prefixMatch = modelId.match(/^(qwen(?:\d+\.\d+|2(?:\.\d+)?|-\d+b|-(?:max|coder|vl)))/i)
      const groupKey = prefixMatch ? prefixMatch[1] : model.group || '其他'

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(model)
      return groups
    },
    {} as Record<string, ProviderSettingsModel[]>
  )
}

export function isFreeModel(model: Pick<ProviderSettingsModel, 'id' | 'name' | 'providerId'>): boolean {
  if (model.providerId === 'cherryai') {
    return true
  }

  return (model.id + model.name).toLowerCase().includes('free')
}

export function isRerankModel(model: ProviderSettingsModel): boolean {
  const capabilityState = getCapabilityState(model, 'rerank')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  return RERANKING_REGEX.test(getLowerBaseModelName(model.id))
}

export function isEmbeddingModel(model: ProviderSettingsModel): boolean {
  if (!model || isRerankModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'embedding')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  const providerId = getProviderId(model)
  if (providerId === 'anthropic') {
    return false
  }

  if (providerId === 'doubao' || modelId.includes('doubao')) {
    return EMBEDDING_REGEX.test(model.name)
  }

  return EMBEDDING_REGEX.test(modelId)
}

function isDedicatedImageModel(model: ProviderSettingsModel): boolean {
  return DEDICATED_IMAGE_MODEL_REGEX.test(getLowerBaseModelName(model.id))
}

export function isVisionModel(model: ProviderSettingsModel): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'vision')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  const providerId = getProviderId(model)

  if (providerId === 'doubao' || modelId.includes('doubao')) {
    return VISION_REGEX.test(model.name) || VISION_REGEX.test(modelId)
  }

  return VISION_REGEX.test(modelId) || IMAGE_ENHANCEMENT_MODELS_REGEX.test(modelId)
}

export function isFunctionCallingModel(model?: ProviderSettingsModel): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'function_calling')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  const providerId = getProviderId(model)
  if (providerId === 'doubao' || modelId.includes('doubao')) {
    return FUNCTION_CALLING_REGEX.test(modelId) || FUNCTION_CALLING_REGEX.test(model.name)
  }

  if (isDeepSeekHybridInferenceModel(model)) {
    return !['dashscope', 'doubao'].includes(providerId ?? '')
  }

  return FUNCTION_CALLING_REGEX.test(modelId)
}

export function isWebSearchModel(model: ProviderSettingsModel): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'web_search')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const providerId = getProviderId(model)
  if (!providerId) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  if (isAnthropicModel(model) && providerId !== 'aws-bedrock') {
    if (providerId === 'vertexai') {
      return isClaude4SeriesModel(model)
    }
    return CLAUDE_SUPPORTED_WEBSEARCH_REGEX.test(modelId)
  }

  if (hasEndpointType(model, 'openai-responses') || providerId === 'azure-openai') {
    if (isOpenAIWebSearchModel(model)) {
      return true
    }
    return providerId === 'grok'
  }

  if (providerId === 'perplexity') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  if (providerId === 'aihubmix') {
    return (!modelId.endsWith('-search') && GEMINI_SEARCH_REGEX.test(modelId)) || isOpenAIWebSearchModel(model)
  }

  if (hasEndpointType(model, 'openai-chat-completions') || NEW_API_PROVIDER_IDS.includes(providerId)) {
    if (GEMINI_SEARCH_REGEX.test(modelId) || isOpenAIWebSearchModel(model)) {
      return true
    }
  }

  if (hasEndpointType(model, 'google-generate-content')) {
    return GEMINI_SEARCH_REGEX.test(modelId)
  }

  if (providerId === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  if (providerId === 'zhipu') {
    return false
  }

  if (providerId === 'dashscope') {
    return ['qwen-turbo', 'qwen-max', 'qwen-plus', 'qwq', 'qwen-flash', 'qwen3-max'].some((id) =>
      modelId.startsWith(id)
    )
  }

  return providerId === 'openrouter'
}

export function isReasoningModel(model?: ProviderSettingsModel): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'reasoning')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  const providerId = getProviderId(model)
  if (providerId === 'doubao' || modelId.includes('doubao')) {
    return (
      REASONING_REGEX.test(modelId) ||
      REASONING_REGEX.test(model.name) ||
      isSupportedThinkingTokenDoubaoModel(model) ||
      isDeepSeekHybridInferenceModel(model)
    )
  }

  return (
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
    isMiMoReasoningModel(model) ||
    isBaichuanReasoningModel(model) ||
    isKimiReasoningModel(model) ||
    isGrok4FastReasoningModel(model) ||
    isQwenAlwaysThinkModel(model) ||
    modelId.includes('magistral') ||
    modelId.includes('pangu-pro-moe') ||
    modelId.includes('seed-oss') ||
    modelId.includes('deepseek-v3.2-speciale') ||
    modelId.includes('gemma-4') ||
    modelId.includes('gemma4') ||
    REASONING_REGEX.test(modelId)
  )
}
