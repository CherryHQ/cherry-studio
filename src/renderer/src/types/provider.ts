import OpenAI from '@cherrystudio/openai'
import { Model } from '@types'
import * as z from 'zod'

import { OpenAIVerbosity } from './aiCoreTypes'

export const ProviderTypeSchema = z.enum([
  'openai',
  'openai-response',
  'anthropic',
  'gemini',
  'qwenlm',
  'azure-openai',
  'vertexai',
  'mistral',
  'aws-bedrock',
  'vertex-anthropic',
  'new-api'
])

export type ProviderType = z.infer<typeof ProviderTypeSchema>

// undefined 视为支持，默认支持
export type ProviderApiOptions = {
  /** 是否不支持 message 的 content 为数组类型 */
  isNotSupportArrayContent?: boolean
  /** 是否不支持 stream_options 参数 */
  isNotSupportStreamOptions?: boolean
  /**
   * @deprecated
   * 是否不支持 message 的 role 为 developer */
  isNotSupportDeveloperRole?: boolean
  /* 是否支持 message 的 role 为 developer */
  isSupportDeveloperRole?: boolean
  /**
   * @deprecated
   * 是否不支持 service_tier 参数. Only for OpenAI Models. */
  isNotSupportServiceTier?: boolean
  /* 是否支持 service_tier 参数. Only for OpenAI Models. */
  isSupportServiceTier?: boolean
  /** 是否不支持 enable_thinking 参数 */
  isNotSupportEnableThinking?: boolean
}

// scale is not well supported now. It even lacks of docs
// We take undefined as same as default, and null as same as explicitly off.
export type OpenAIServiceTier = Exclude<OpenAI.Responses.ResponseCreateParams['service_tier'], 'scale'>

export const OpenAIServiceTiers = {
  auto: 'auto',
  default: 'default',
  flex: 'flex',
  priority: 'priority'
} as const satisfies Record<NonNullable<OpenAIServiceTier>, OpenAIServiceTier>

export function isOpenAIServiceTier(tier: string | null | undefined): tier is OpenAIServiceTier {
  return tier === null || tier === undefined || Object.hasOwn(OpenAIServiceTiers, tier)
}

// https://console.groq.com/docs/api-reference#responses
export type GroqServiceTier = 'auto' | 'on_demand' | 'flex' | undefined | null

export const GroqServiceTiers = {
  auto: 'auto',
  on_demand: 'on_demand',
  flex: 'flex'
} as const satisfies Record<string, GroqServiceTier>

export function isGroqServiceTier(tier: string | undefined | null): tier is GroqServiceTier {
  return tier === null || tier === undefined || Object.hasOwn(GroqServiceTiers, tier)
}

export type ServiceTier = OpenAIServiceTier | GroqServiceTier

export function isServiceTier(tier: string | null | undefined): tier is ServiceTier {
  return isGroqServiceTier(tier) || isOpenAIServiceTier(tier)
}

export type Provider = {
  id: string
  type: ProviderType
  name: string
  apiKey: string
  apiHost: string
  anthropicApiHost?: string
  isAnthropicModel?: (m: Model) => boolean
  apiVersion?: string
  models: Model[]
  enabled?: boolean
  isSystem?: boolean
  isAuthed?: boolean
  rateLimit?: number

  // API options
  apiOptions?: ProviderApiOptions
  serviceTier?: ServiceTier
  verbosity?: OpenAIVerbosity

  /** @deprecated */
  isNotSupportArrayContent?: boolean
  /** @deprecated */
  isNotSupportStreamOptions?: boolean
  /** @deprecated */
  isNotSupportDeveloperRole?: boolean
  /** @deprecated */
  isNotSupportServiceTier?: boolean

  authType?: 'apiKey' | 'oauth'
  isVertex?: boolean
  notes?: string
  extra_headers?: Record<string, string>
}

export const SystemProviderIdSchema = z.enum([
  'cherryin',
  'silicon',
  'aihubmix',
  'ocoolai',
  'deepseek',
  'ppio',
  'alayanew',
  'qiniu',
  'dmxapi',
  'burncloud',
  'tokenflux',
  '302ai',
  'cephalon',
  'lanyun',
  'ph8',
  'openrouter',
  'ollama',
  'ovms',
  'new-api',
  'lmstudio',
  'anthropic',
  'openai',
  'azure-openai',
  'gemini',
  'vertexai',
  'github',
  'copilot',
  'zhipu',
  'yi',
  'moonshot',
  'baichuan',
  'dashscope',
  'stepfun',
  'doubao',
  'infini',
  'minimax',
  'groq',
  'together',
  'fireworks',
  'nvidia',
  'grok',
  'hyperbolic',
  'mistral',
  'jina',
  'perplexity',
  'modelscope',
  'xirang',
  'hunyuan',
  'tencent-cloud-ti',
  'baidu-cloud',
  'gpustack',
  'voyageai',
  'aws-bedrock',
  'poe',
  'aionly',
  'longcat',
  'huggingface'
])

export type SystemProviderId = z.infer<typeof SystemProviderIdSchema>

export const isSystemProviderId = (id: string): id is SystemProviderId => {
  return SystemProviderIdSchema.safeParse(id).success
}

export const SystemProviderIds = {
  cherryin: 'cherryin',
  silicon: 'silicon',
  aihubmix: 'aihubmix',
  ocoolai: 'ocoolai',
  deepseek: 'deepseek',
  ppio: 'ppio',
  alayanew: 'alayanew',
  qiniu: 'qiniu',
  dmxapi: 'dmxapi',
  burncloud: 'burncloud',
  tokenflux: 'tokenflux',
  '302ai': '302ai',
  cephalon: 'cephalon',
  lanyun: 'lanyun',
  ph8: 'ph8',
  openrouter: 'openrouter',
  ollama: 'ollama',
  ovms: 'ovms',
  'new-api': 'new-api',
  lmstudio: 'lmstudio',
  anthropic: 'anthropic',
  openai: 'openai',
  'azure-openai': 'azure-openai',
  gemini: 'gemini',
  vertexai: 'vertexai',
  github: 'github',
  copilot: 'copilot',
  zhipu: 'zhipu',
  yi: 'yi',
  moonshot: 'moonshot',
  baichuan: 'baichuan',
  dashscope: 'dashscope',
  stepfun: 'stepfun',
  doubao: 'doubao',
  infini: 'infini',
  minimax: 'minimax',
  groq: 'groq',
  together: 'together',
  fireworks: 'fireworks',
  nvidia: 'nvidia',
  grok: 'grok',
  hyperbolic: 'hyperbolic',
  mistral: 'mistral',
  jina: 'jina',
  perplexity: 'perplexity',
  modelscope: 'modelscope',
  xirang: 'xirang',
  hunyuan: 'hunyuan',
  'tencent-cloud-ti': 'tencent-cloud-ti',
  'baidu-cloud': 'baidu-cloud',
  gpustack: 'gpustack',
  voyageai: 'voyageai',
  'aws-bedrock': 'aws-bedrock',
  poe: 'poe',
  aionly: 'aionly',
  longcat: 'longcat',
  huggingface: 'huggingface'
} as const satisfies Record<SystemProviderId, SystemProviderId>

export type SystemProviderIdTypeMap = typeof SystemProviderIds

export type SystemProvider = Provider & {
  id: SystemProviderId
  isSystem: true
  apiOptions?: never
}

export type VertexProvider = Provider & {
  googleCredentials: {
    privateKey: string
    clientEmail: string
  }
  project: string
  location: string
}

/**
 * 判断是否为系统内置的提供商。比直接使用`provider.isSystem`更好，因为该数据字段不会随着版本更新而变化。
 * @param provider - Provider对象，包含提供商的信息
 * @returns 是否为系统内置提供商
 */
export const isSystemProvider = (provider: Provider): provider is SystemProvider => {
  return isSystemProviderId(provider.id) && !!provider.isSystem
}

export type GroqSystemProvider = Provider & {
  id: SystemProviderIdTypeMap['groq']
  isSystem: true
}

export type NotGroqProvider = Provider & {
  id: Exclude<string, SystemProviderIdTypeMap['groq']>
}

export const isGroqSystemProvider = (provider: Provider): provider is GroqSystemProvider => {
  return provider.id === SystemProviderIds.groq
}
