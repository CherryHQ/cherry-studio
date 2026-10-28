import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
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

export function resolveDmxapiEndpointType(modelId: string): EndpointType {
  return DMXAPI_ENDPOINT[resolveDmxapiChatFamily(modelId)]
}

const GATEWAY_MODEL_DEFAULTS: Partial<Record<string, (modelId: string) => EndpointType>> = {
  [SystemProviderIds.aihubmix]: resolveAihubmixEndpointType,
  [SystemProviderIds.dmxapi]: resolveDmxapiEndpointType
}

/** A deployment's default model endpoint; explicit model declarations remain authoritative. */
export function resolveGatewayDefaultEndpoint(
  provider: Pick<Provider, 'id' | 'endpointConfigs'> & { presetProviderId?: string | null },
  modelId: string
): EndpointType | undefined {
  const suggest =
    GATEWAY_MODEL_DEFAULTS[provider.id] ??
    (provider.presetProviderId ? GATEWAY_MODEL_DEFAULTS[provider.presetProviderId] : undefined)
  const endpoint = suggest?.(modelId)
  return endpoint && provider.endpointConfigs?.[endpoint] ? endpoint : undefined
}
