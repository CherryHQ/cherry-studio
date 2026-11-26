import { ENDPOINT_TYPE, type EndpointType, type Model, type RuntimeModelPricing } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ProviderBilling } from '@shared/data/types/providerBilling'

const deepseekModels = ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']

type TokenRates = [input: number, output: number, cacheRead: number, cacheWrite?: number]

// https://open.cherryin.ai/api/pricing publishes these rates per million tokens for the default group.
const cherryInPeakRates = new Map<string, TokenRates>([
  ['agent/deepseek-v4-flash', [0.3, 1.2, 0.006]],
  ['agent/deepseek-v4-pro', [1.35, 4.05, 0.045]],
  ['deepseek-v4.1-flash', [0.3, 1.2, 0.006]],
  ['deepseek/deepseek-flash', [0.3, 1.2, 0.006]],
  ['deepseek/deepseek-v4-flash', [0.3, 1.2, 0.006]],
  ['deepseek/deepseek-v4-flash-vision-exp', [0.3, 1.2, 0.006]],
  ['deepseek/deepseek-v4-pro', [1.35, 4.05, 0.045]],
  ['deepseek/deepseek-v4.1-flash-1017', [0.3, 1.2, 0.006]]
])

const cherryInCacheDurationRates = new Map<
  string,
  { rates: TokenRates; longContextRates?: TokenRates; oneHourMultiplier: number }
>([
  [
    'anthropic/claude-haiku-5.5',
    { rates: [0.1, 0.5, 0.01, 0.125], longContextRates: [0.5, 2.5, 0.05, 0.625], oneHourMultiplier: 1.6 }
  ],
  ['moonshotai/kimi-k3.1-pro', { rates: [2, 10, 0.2, 2], oneHourMultiplier: 2 }],
  ['moonshotai/kimi-k3.1-pro-highspeed', { rates: [4, 20, 0.2, 4], oneHourMultiplier: 2 }]
])

type GeminiModalityRates = {
  input: number
  output: number
  cacheRead?: number
  audioInput?: number
  imageOutput?: number
  outputWithoutImage?: number
}

export const CHERRYIN_GEMINI_MODALITY_VERSION = '2026-11-26-gemini-modality'
const cherryInGeminiRates = new Map<string, GeminiModalityRates>([
  ['google/gemini-2.5-flash-image', { input: 0.3, output: 2.5, imageOutput: 30, outputWithoutImage: 30 }],
  ['google/gemini-3-pro-image', { input: 2, output: 12, cacheRead: 0.2, imageOutput: 120 }],
  ['google/gemini-3-pro-image-preview', { input: 2, output: 12, imageOutput: 120, outputWithoutImage: 120 }],
  ['google/gemini-3.1-flash-image', { input: 0.5, output: 3, cacheRead: 0.05, imageOutput: 60 }],
  ['google/gemini-3.1-flash-image-preview', { input: 0.5, output: 3, imageOutput: 60, outputWithoutImage: 60 }],
  ['google/gemini-3.1-flash-lite', { input: 0.25, output: 1.5, cacheRead: 0.025, audioInput: 0.5 }],
  ['google/gemini-3.1-flash-lite-image', { input: 0.25, output: 1.5, cacheRead: 0.025, imageOutput: 30 }],
  ['google/gemini-nano-banana-2.1', { input: 1.5, output: 7.5, cacheRead: 0.15, imageOutput: 30 }]
])

export function getCherryInGeminiModalityRates(modelId: string): GeminiModalityRates | undefined {
  return cherryInGeminiRates.get(modelId)
}

export const CHERRYIN_OPENAI_IMAGE_VERSION = '2026-11-26-openai-image'
const cherryInOpenAIImageModels = new Set([
  'openai/gpt-image-2',
  'openai/gpt-image-2.5-flare',
  'openai/gpt-image-2.5-sunburst',
  'openai/gpt-image-2.6-flare',
  'openai/gpt-image-2.6-sunburst'
])

export function isCherryInOpenAIImageModel(modelId: string): boolean {
  return cherryInOpenAIImageModels.has(modelId)
}

const weekdayBilling: ProviderBilling = {
  defaultMultiplier: 0.5,
  scheduleEnabled: true,
  timeZone: '+08:00',
  calendar: 'cn-weekdays',
  periods: [
    { id: 'morning', name: '09:00–12:00', start: '09:00', end: '12:00', mode: 'multiplier', multiplier: 1 },
    { id: 'afternoon', name: '14:00–18:00', start: '14:00', end: '18:00', mode: 'multiplier', multiplier: 1 }
  ]
}

export const CHERRYIN_WEEKDAY_BILLING: ProviderBilling = { ...weekdayBilling, source: 'cherryin' }
const cherryInUnscheduledBilling: ProviderBilling = {
  source: 'cherryin',
  defaultMultiplier: 1,
  scheduleEnabled: false,
  timeZone: '+08:00',
  periods: []
}

function toTokenPricing([input, output, cacheRead, cacheWrite]: TokenRates): RuntimeModelPricing {
  return {
    input: { currency: 'USD', perMillionTokens: input },
    output: { currency: 'USD', perMillionTokens: output },
    cacheRead: { currency: 'USD', perMillionTokens: cacheRead },
    ...(cacheWrite !== undefined ? { cacheWrite: { currency: 'USD' as const, perMillionTokens: cacheWrite } } : {})
  }
}

export function getCherryInPublishedPricing(modelId: string): RuntimeModelPricing | undefined {
  const peak = cherryInPeakRates.get(modelId)
  if (peak) return toTokenPricing(peak)
  const cached = cherryInCacheDurationRates.get(modelId)
  if (!cached) return undefined
  return {
    ...toTokenPricing(cached.rates),
    ...(cached.longContextRates
      ? { inputTokenTiers: [{ minInputTokens: 100_001, ...toTokenPricing(cached.longContextRates) }] }
      : {})
  }
}

export function getCherryInOneHourCacheWriteMultiplier(modelId: string): number {
  return cherryInCacheDurationRates.get(modelId)?.oneHourMultiplier ?? 1.6
}

/** Only first-party catalog prices inherit the published billing rules. */
export function getDefaultProviderBilling(
  provider: Provider,
  model: Model,
  baseUrl?: string
): ProviderBilling | undefined {
  if (model.hasCustomPricing) return undefined
  const providerId = provider.presetProviderId ?? provider.id
  const modelId = model.apiModelId ?? model.id.slice(model.id.indexOf('::') + 2)
  const isDeepSeek = providerId === 'deepseek' && deepseekModels.includes(modelId)
  const isCherryIn =
    providerId === 'cherryin' &&
    (cherryInPeakRates.has(modelId) ||
      cherryInCacheDurationRates.has(modelId) ||
      cherryInGeminiRates.has(modelId) ||
      isCherryInOpenAIImageModel(modelId))
  if (!isDeepSeek && !isCherryIn) return undefined
  const endpoints: Array<EndpointType | undefined> = [
    model.endpointTypes?.[0],
    provider.defaultChatEndpoint,
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    ENDPOINT_TYPE.OPENAI_RESPONSES,
    ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
    ENDPOINT_TYPE.OLLAMA_CHAT
  ]
  const url =
    baseUrl ??
    endpoints.map((endpoint) => (endpoint ? provider.endpointConfigs?.[endpoint]?.baseUrl : undefined)).find(Boolean) ??
    Object.values(provider.endpointConfigs ?? {}).find((config) => config?.baseUrl)?.baseUrl
  try {
    const parsed = new URL(url ?? '')
    if (parsed.protocol !== 'https:' || parsed.port) return undefined
    if (isDeepSeek && parsed.hostname === 'api.deepseek.com') return { ...weekdayBilling, source: 'deepseek' }
    if (isCherryIn && ['open.cherryin.net', 'open.cherryin.ai', 'open.cherryin.cc'].includes(parsed.hostname)) {
      return cherryInPeakRates.has(modelId) ? CHERRYIN_WEEKDAY_BILLING : cherryInUnscheduledBilling
    }
  } catch {
    return undefined
  }
  return undefined
}
