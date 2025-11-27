import { createProvider as createProviderCore } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type { Provider } from '@renderer/types'
import { getAiSdkProviderId as sharedGetAiSdkProviderId } from '@shared/provider'
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
 * 获取AI SDK Provider ID
 * Uses shared implementation with renderer-specific config checker
 */
export function getAiSdkProviderId(provider: Provider): string {
  return sharedGetAiSdkProviderId(provider)
}

export async function createAiSdkProvider(config: AiSdkConfig): Promise<AiSdkProvider | null> {
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
