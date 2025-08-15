import { AiCore, getProviderMapping, type ProviderId } from '@cherrystudio/ai-core'
import { Provider } from '@renderer/types'

import { initializeNewProviders } from './providerConfigs'

// 初始化新的Provider注册系统
initializeNewProviders()

// 静态Provider映射 - 核心providers
const STATIC_PROVIDER_MAPPING: Record<string, ProviderId> = {
  // anthropic: 'anthropic',
  gemini: 'google',
  'azure-openai': 'azure',
  'openai-response': 'openai',
  grok: 'xai'
}

export function getAiSdkProviderId(provider: Provider): ProviderId | 'openai-compatible' {
  // 1. 首先检查静态映射
  const staticProviderId = STATIC_PROVIDER_MAPPING[provider.id]
  if (staticProviderId) {
    return staticProviderId
  }

  // 2. 检查动态注册的provider映射（使用aiCore的函数）
  const dynamicProviderId = getProviderMapping(provider.id)
  if (dynamicProviderId) {
    return dynamicProviderId as ProviderId
  }

  // 3. 检查provider.type的静态映射
  const staticProviderType = STATIC_PROVIDER_MAPPING[provider.type]
  if (staticProviderType) {
    return staticProviderType
  }

  // 4. 检查provider.type的动态映射
  const dynamicProviderType = getProviderMapping(provider.type)
  if (dynamicProviderType) {
    return dynamicProviderType as ProviderId
  }

  // 5. 检查AiCore是否直接支持
  if (AiCore.isSupported(provider.id)) {
    return provider.id as ProviderId
  }

  // 6. 最后的fallback
  return provider.id as ProviderId
}
