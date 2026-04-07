import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import { type Provider, SystemProviderIds } from '@renderer/types'
import { isAzureOpenAIProvider, isAzureResponsesEndpoint } from '@renderer/utils/provider'

import { type AppProviderId, appProviderIds } from '../types'
import { extensions } from './extensions'

const logger = loggerService.withContext('ProviderFactory')

for (const extension of extensions) {
  if (!extensionRegistry.has(extension.config.name)) {
    extensionRegistry.register(extension)
  }
}

/**
 * 获取 AI SDK Provider ID
 *
 * 使用运行时类型安全的 appProviderIds 统一解析
 * 特殊处理 Azure 端点检测和 OpenAI API 域名检测
 *
 * @param provider - Provider 配置对象
 * @returns AI SDK 标准 provider ID
 */
export function getAiSdkProviderId(provider: Provider): AppProviderId {
  // 1. 特殊处理：Azure 的 responses 端点检测（必须在别名解析之前）
  if (isAzureOpenAIProvider(provider)) {
    return isAzureResponsesEndpoint(provider) ? appProviderIds['azure-responses'] : appProviderIds.azure
  }

  if (provider.id === SystemProviderIds.grok) {
    return appProviderIds['xai-responses']
  }

  if (provider.id in appProviderIds) {
    return appProviderIds[provider.id]
  }

  if (provider.type !== 'openai' && provider.type in appProviderIds) {
    return appProviderIds[provider.type]
  }

  if (provider.apiHost.includes('api.openai.com')) {
    return appProviderIds['openai-chat']
  }

  logger.warn('Provider ID not found in registered extensions, using as-is', {
    providerId: provider.id,
    providerType: provider.type,
    registeredIds: Object.keys(appProviderIds)
  })
  return provider.id
}
