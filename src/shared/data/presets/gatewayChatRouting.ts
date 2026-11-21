import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

export type AihubmixChatFamily = 'anthropic' | 'gemini' | 'openai-responses' | 'openai-chat' | 'compat'
export type DmxapiChatFamily = 'openai-compat' | 'openai' | 'anthropic' | 'gemini'

const isOpenAILLM = (modelId: string): boolean => {
  const id = modelId.toLowerCase()
  return /\bgpt\b|^o[134]/.test(id) && !id.includes('gpt-4o-image')
}

const isOpenAIChatCompletionOnly = (modelId: string): boolean => {
  const id = modelId.toLowerCase()
  return (
    id.includes('gpt-4o-search-preview') ||
    id.includes('gpt-4o-mini-search-preview') ||
    id.includes('o1-mini') ||
    id.includes('o1-preview')
  )
}

export function resolveAihubmixChatFamily(modelId: string): AihubmixChatFamily {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (
    (modelId.startsWith('gemini') || modelId.startsWith('imagen')) &&
    !modelId.endsWith('no-think') &&
    !modelId.endsWith('-search') &&
    !modelId.includes('embedding')
  ) {
    return 'gemini'
  }
  if (isOpenAILLM(modelId)) return isOpenAIChatCompletionOnly(modelId) ? 'openai-chat' : 'openai-responses'
  return 'compat'
}

const AIHUBMIX_ENDPOINT: Record<AihubmixChatFamily, EndpointType> = {
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'openai-responses': ENDPOINT_TYPE.OPENAI_RESPONSES,
  'openai-chat': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  compat: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

const AIHUBMIX_OPTIONS_KEY: Record<AihubmixChatFamily, string> = {
  anthropic: 'anthropic',
  gemini: 'google',
  'openai-responses': 'openai',
  'openai-chat': 'openai',
  compat: 'aihubmix'
}

export function resolveAihubmixEndpointType(modelId: string): EndpointType {
  return AIHUBMIX_ENDPOINT[resolveAihubmixChatFamily(modelId)]
}

const DMXAPI_FAMILIES: Array<{
  family: Exclude<DmxapiChatFamily, 'openai-compat'>
  match: (modelId: string) => boolean
}> = [
  { family: 'anthropic', match: (id) => /claude/i.test(id) },
  { family: 'gemini', match: (id) => /^gemini-/i.test(id) && !/(image|imagen|tts|audio|embedding)/i.test(id) },
  { family: 'openai', match: (id) => /^(gpt-|o\d)/i.test(id) && !/(image|dall-e)/i.test(id) }
]

export function resolveDmxapiChatFamily(modelId: string): DmxapiChatFamily {
  return DMXAPI_FAMILIES.find((entry) => entry.match(modelId))?.family ?? 'openai-compat'
}

const DMXAPI_ENDPOINT: Record<DmxapiChatFamily, EndpointType> = {
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  openai: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-compat': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

const DMXAPI_OPTIONS_KEY: Record<DmxapiChatFamily, string> = {
  anthropic: 'anthropic',
  gemini: 'google',
  openai: 'openai',
  'openai-compat': 'dmxapi'
}

export interface GatewayModelRoute {
  endpointType: EndpointType
  providerOptionsKey: string
}

export function resolveAihubmixChatRoute(modelId: string): GatewayModelRoute {
  const family = resolveAihubmixChatFamily(modelId)
  return { endpointType: AIHUBMIX_ENDPOINT[family], providerOptionsKey: AIHUBMIX_OPTIONS_KEY[family] }
}

export function resolveDmxapiChatRoute(modelId: string): GatewayModelRoute {
  const family = resolveDmxapiChatFamily(modelId)
  return { endpointType: DMXAPI_ENDPOINT[family], providerOptionsKey: DMXAPI_OPTIONS_KEY[family] }
}

export function resolveDmxapiEndpointType(modelId: string): EndpointType {
  return resolveDmxapiChatRoute(modelId).endpointType
}

export type CherryinChatFamily = 'anthropic' | 'gemini' | 'openai-responses' | 'openai-chat' | 'compat'

export function resolveCherryinChatFamily(modelId: string): CherryinChatFamily {
  const baseId = modelId.toLowerCase().split('/').pop() ?? modelId.toLowerCase()
  if (baseId.startsWith('claude')) return 'anthropic'
  if (
    baseId.startsWith('imagen') &&
    !baseId.endsWith('no-think') &&
    !baseId.endsWith('-search') &&
    !baseId.includes('embedding')
  ) {
    return 'gemini'
  }
  if (
    baseId.startsWith('gemini') &&
    !baseId.endsWith('no-think') &&
    !baseId.endsWith('-search') &&
    !baseId.includes('embedding') &&
    !baseId.includes('image')
  ) {
    return 'gemini'
  }
  if (isOpenAILLM(baseId)) return isOpenAIChatCompletionOnly(baseId) ? 'openai-chat' : 'openai-responses'
  return 'compat'
}

const CHERRYIN_ENDPOINT: Record<CherryinChatFamily, EndpointType> = {
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'openai-responses': ENDPOINT_TYPE.OPENAI_RESPONSES,
  'openai-chat': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  compat: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

const CHERRYIN_OPTIONS_KEY: Record<CherryinChatFamily, string> = {
  anthropic: 'anthropic',
  gemini: 'google',
  'openai-responses': 'openai',
  'openai-chat': 'openai',
  compat: 'cherryin'
}

export function resolveCherryinChatRoute(modelId: string): GatewayModelRoute {
  const family = resolveCherryinChatFamily(modelId)
  return { endpointType: CHERRYIN_ENDPOINT[family], providerOptionsKey: CHERRYIN_OPTIONS_KEY[family] }
}

export function resolveCherryinEndpointType(modelId: string): EndpointType {
  return CHERRYIN_ENDPOINT[resolveCherryinChatFamily(modelId)]
}

const GATEWAY_MODEL_ROUTERS: Partial<Record<string, (modelId: string) => GatewayModelRoute>> = {
  [SystemProviderIds.aihubmix]: resolveAihubmixChatRoute,
  [SystemProviderIds.dmxapi]: resolveDmxapiChatRoute,
  [SystemProviderIds.cherryin]: resolveCherryinChatRoute
}

/** Resolve a gateway's per-model wire route from data available in both main and renderer. */
export function resolveGatewayChatRoute(provider: Provider, model: Model): GatewayModelRoute | undefined {
  const router =
    GATEWAY_MODEL_ROUTERS[provider.id] ??
    (provider.presetProviderId ? GATEWAY_MODEL_ROUTERS[provider.presetProviderId] : undefined)
  const route = router?.(model.apiModelId ?? model.id)
  return route && provider.endpointConfigs?.[route.endpointType] ? route : undefined
}
