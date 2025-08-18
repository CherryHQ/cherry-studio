import type { ProviderConfig } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ProviderConfigs')

/**
 * 新Provider配置定义
 * 定义了需要动态注册的AI Providers
 */
export const NEW_PROVIDER_CONFIGS: (ProviderConfig & {
  mappings?: Record<string, string>
})[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    import: () => import('@openrouter/ai-sdk-provider'),
    creatorFunctionName: 'createOpenRouter',
    supportsImageGeneration: true,
    mappings: {
      openrouter: 'openrouter'
    }
  },
  {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    import: () => import('@ai-sdk/google-vertex'),
    creatorFunctionName: 'createGoogleVertex',
    supportsImageGeneration: true,
    mappings: {
      'google-vertex': 'google-vertex',
      vertexai: 'google-vertex'
    }
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    import: () => import('@ai-sdk/amazon-bedrock'),
    creatorFunctionName: 'createAmazonBedrock',
    supportsImageGeneration: true,
    mappings: {
      'aws-bedrock': 'bedrock'
    }
  }
] as const

/**
 * 初始化新的Providers
 * 使用aiCore的动态注册功能
 */
export async function initializeNewProviders(): Promise<void> {
  try {
    // 动态导入以避免循环依赖
    const { registerMultipleProviders } = await import('@cherrystudio/ai-core')

    const successCount = registerMultipleProviders(NEW_PROVIDER_CONFIGS)

    if (successCount < NEW_PROVIDER_CONFIGS.length) {
      logger.warn('Some providers failed to register. Check previous error logs.')
    }
  } catch (error) {
    logger.error('Failed to initialize new providers:', error as Error)
  }
}
