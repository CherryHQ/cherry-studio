/**
 * DMXAPI per-model chat routing — single source of truth for the runtime model class, endpoint
 * protocol, and provider-options namespace.
 */
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

export type DmxapiChatFamily = 'openai-compat' | 'openai' | 'anthropic' | 'gemini'

const CHAT_FAMILY_TABLE: Array<{
  family: Exclude<DmxapiChatFamily, 'openai-compat'>
  match: (modelId: string) => boolean
}> = [
  { family: 'anthropic', match: (id) => /claude/i.test(id) },
  {
    family: 'gemini',
    // Gemini chat models only; image, TTS, audio, and embedding variants have separate routes.
    match: (id) => /^gemini-/i.test(id) && !/(image|imagen|tts|audio|embedding)/i.test(id)
  },
  {
    family: 'openai',
    // Native OpenAI chat models. Image variants are handled by the image-model router.
    match: (id) => /^(gpt-|o\d)/i.test(id) && !/(image|dall-e)/i.test(id)
  }
]

export function resolveDmxapiChatFamily(modelId: string): DmxapiChatFamily {
  return CHAT_FAMILY_TABLE.find((entry) => entry.match(modelId))?.family ?? 'openai-compat'
}

const FAMILY_ENDPOINT: Record<DmxapiChatFamily, EndpointType> = {
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  openai: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-compat': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

const FAMILY_PROVIDER_OPTIONS_KEY: Record<DmxapiChatFamily, string> = {
  anthropic: 'anthropic',
  gemini: 'google',
  // @ai-sdk/openai's chat model reads the canonical `openai` namespace.
  openai: 'openai',
  // @ai-sdk/openai-compatible derives this from the `dmxapi.chat` provider string.
  'openai-compat': 'dmxapi'
}

export interface DmxapiChatRoute {
  endpointType: EndpointType
  providerOptionsKey: string
}

export function resolveDmxapiChatRoute(modelId: string): DmxapiChatRoute {
  const family = resolveDmxapiChatFamily(modelId)
  return {
    endpointType: FAMILY_ENDPOINT[family],
    providerOptionsKey: FAMILY_PROVIDER_OPTIONS_KEY[family]
  }
}

export function resolveDmxapiEndpointType(modelId: string): EndpointType {
  return resolveDmxapiChatRoute(modelId).endpointType
}
