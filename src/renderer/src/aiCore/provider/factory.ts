import { hasProviderConfigByAlias, type ProviderId, resolveProviderConfigId } from '@cherrystudio/ai-core/provider'
import { createProvider as createProviderCore } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type { Provider } from '@renderer/types'
import { isAzureOpenAIProvider, isAzureResponsesEndpoint } from '@renderer/utils/provider'
import type { Provider as AiSdkProvider } from 'ai'

import type { AiSdkConfig } from '../types'
import { initializeNewProviders } from './providerInitialization'

const logger = loggerService.withContext('ProviderFactory')

/**
 * 初始化动态Provider系统
 * 在模块加载时自动注册新的providers
 */
;(async () => {
  try {
    await initializeNewProviders()
  } catch (error) {
    logger.warn('Failed to initialize new providers:', error as Error)
  }
})()

/**
 * 静态Provider映射表
 * 处理Cherry Studio特有的provider ID到AI SDK标准ID的映射
 */
const STATIC_PROVIDER_MAPPING: Record<string, ProviderId> = {
  gemini: 'google', // Google Gemini -> google
  'azure-openai': 'azure', // Azure OpenAI -> azure
  'openai-response': 'openai', // OpenAI Responses -> openai
  grok: 'xai', // Grok -> xai
  copilot: 'github-copilot-openai-compatible',
  tokenflux: 'openrouter' // TokenFlux -> openrouter (fully compatible)
}

/**
 * 尝试解析provider标识符（支持静态映射和别名）
 */
function tryResolveProviderId(identifier: string): ProviderId | null {
  // 1. 检查静态映射
  const staticMapping = STATIC_PROVIDER_MAPPING[identifier]
  if (staticMapping) {
    return staticMapping
  }

  // 2. 检查AiCore是否支持（包括别名支持）
  if (hasProviderConfigByAlias(identifier)) {
    // 解析为真实的Provider ID
    return resolveProviderConfigId(identifier) as ProviderId
  }

  return null
}

/**
 * 获取AI SDK Provider ID
 * 简化版：减少重复逻辑，利用通用解析函数
 */
export function getAiSdkProviderId(provider: Provider): string {
  // 1. Azure requires special handling: pick responses vs chat variant based on API version
  if (isAzureOpenAIProvider(provider)) {
    return isAzureResponsesEndpoint(provider) ? 'azure' : 'azure-chat'
  }

  // 2. 尝试解析provider.id（静态映射 + 别名）
  const resolvedFromId = tryResolveProviderId(provider.id)
  if (resolvedFromId) {
    return resolvedFromId
  }

  // 3. 尝试解析provider.type（跳过 'openai' 以避免把自定义provider错误映射）
  if (provider.type !== 'openai') {
    const resolvedFromType = tryResolveProviderId(provider.type)
    if (resolvedFromType) {
      return resolvedFromType
    }
  }

  // 4. OpenAI API host detection
  if (provider.apiHost.includes('api.openai.com')) {
    return 'openai-chat'
  }

  // 5. Fallback to provider's own id
  return provider.id
}

export async function createAiSdkProvider(config: AiSdkConfig): Promise<AiSdkProvider | null> {
  // Redirect providers that need the chat completions variant
  // Note: azure is included for defensive consistency with registry.ts,
  // even though getAiSdkProviderId resolves azure-chat upstream for dated API versions
  const chatRedirectIds = ['openai', 'azure', 'cherryin']
  if (chatRedirectIds.includes(config.providerId) && config.options?.mode === 'chat') {
    config.providerId = `${config.providerId}-chat`
  }

  try {
    const localProvider = await createProviderCore(config.providerId, config.options)

    logger.debug('Local provider created successfully', {
      providerId: config.providerId,
      hasOptions: !!config.options,
      localProvider,
      options: config.options
    })

    return localProvider
  } catch (error) {
    logger.error('Failed to create local provider', error as Error, {
      providerId: config.providerId
    })
    throw error
  }
}
