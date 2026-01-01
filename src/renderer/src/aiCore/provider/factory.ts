import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type { Provider } from '@renderer/types'
import { isAzureOpenAIProvider, isAzureResponsesEndpoint } from '@renderer/utils/provider'

import { type AppProviderId, appProviderIds } from '../types'
import { extensions } from './extensions'

const logger = loggerService.withContext('ProviderFactory')

extensionRegistry.registerAll([...extensions])

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

  // 2. 尝试直接使用 provider.id（运行时验证）
  if (provider.id in appProviderIds) {
    const resolvedId = appProviderIds[provider.id]
    if (resolvedId) {
      return resolvedId
    }
  }

  // 3. 尝试从 provider.type 解析（非 openai 类型）
  // 会把所有类型为 openai 的自定义 provider 解析到 AI SDK 的 openai provider 上
  if (provider.type !== 'openai' && provider.type in appProviderIds) {
    const resolvedId = appProviderIds[provider.type]
    if (resolvedId) {
      return resolvedId
    }
  }

  // 4. OpenAI API 域名检测
  if (provider.apiHost.includes('api.openai.com')) {
    const openaiChatId = appProviderIds['openai-chat']
    if (openaiChatId) {
      return openaiChatId
    }
  }

  // 5. Fallback：使用 provider 本身的 id（带警告）
  logger.warn('Provider ID not found in registered extensions, using as-is', {
    providerId: provider.id,
    providerType: provider.type,
    registeredIds: Object.keys(appProviderIds)
  })
  return provider.id as AppProviderId
}
