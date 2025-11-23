import { hasProviderConfigByAlias, type ProviderId, resolveProviderConfigId } from '@cherrystudio/ai-core/provider'
import { createProvider as createProviderCore } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type { Provider } from '@renderer/types'
import { isAzureOpenAIProvider, isAzureResponsesEndpoint } from '@renderer/utils/provider'
import type { Provider as AiSdkProvider } from 'ai'

import type { providerToAiSdkConfig } from './providerConfig'
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
  copilot: 'github-copilot-openai-compatible'
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
export function getAiSdkProviderId(provider: Provider): ProviderId | 'openai-compatible' {
  // 1. 尝试解析provider.id
  const resolvedFromId = tryResolveProviderId(provider.id)
  if (isAzureOpenAIProvider(provider) && isAzureResponsesEndpoint(provider)) {
    return 'azure-responses'
  }
  if (resolvedFromId) {
    return resolvedFromId
  }

  // 2. 尝试解析provider.type
  // 会把所有类型为openai的自定义provider解析到aisdk的openaiProvider上
  if (provider.type !== 'openai') {
    const resolvedFromType = tryResolveProviderId(provider.type)
    if (resolvedFromType) {
      return resolvedFromType
    }
  }
  if (provider.apiHost.includes('api.openai.com')) {
    return 'openai-chat'
  }
  // 3. 最后的fallback（通常会成为openai-compatible）
  return provider.id as ProviderId
}

export async function createAiSdkProvider(
  config: ReturnType<typeof providerToAiSdkConfig>
): Promise<AiSdkProvider | null> {
  let localProvider: Awaited<AiSdkProvider> | null = null
  try {
    if (config.providerId === 'openai' && config.options?.mode === 'chat') {
      config.providerId = `${config.providerId}-chat`
    } else if (config.providerId === 'azure' && config.options?.mode === 'responses') {
      config.providerId = `${config.providerId}-responses`
    } else if (config.providerId === 'cherryin' && config.options?.mode === 'chat') {
      config.providerId = 'cherryin-chat'
    }
    localProvider = await createProviderCore(config.providerId, config.options)

    logger.debug('Local provider created successfully', {
      providerId: config.providerId,
      hasOptions: !!config.options,
      localProvider: localProvider,
      options: config.options
    })
  } catch (error) {
    logger.error('Failed to create local provider', error as Error, {
      providerId: config.providerId
    })
    throw error
  }
  return localProvider
}
