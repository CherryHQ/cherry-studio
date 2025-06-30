import { AiCore, ProviderId } from '@cherrystudio/ai-core'
import { Provider } from '@renderer/types'

const PROVIDER_MAPPING: Record<string, ProviderId> = {
  // anthropic: 'anthropic',
  gemini: 'google',
  vertexai: 'google-vertex',
  'azure-openai': 'azure',
  'openai-response': 'openai',
  grok: 'xai'
}

export function getAiSdkProviderId(provider: Provider): ProviderId | 'openai-compatible' {
  const providerId = PROVIDER_MAPPING[provider.id]

  if (providerId) {
    return providerId
  }

  const providerType = PROVIDER_MAPPING[provider.type] // 有些第三方需要映射到aicore对应sdk

  if (providerType) {
    return providerType
  }

  if (AiCore.isSupported(provider.id)) {
    return provider.id as ProviderId
  }

  return provider.id as ProviderId
}
