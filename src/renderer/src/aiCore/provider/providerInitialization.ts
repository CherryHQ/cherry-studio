import { type ProviderConfig, registerMultipleProviderConfigs } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ProviderConfigs')

/**
 * 新Provider配置定义
 * 定义了需要动态注册的AI Providers
 */
export const NEW_PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    import: () => import('@openrouter/ai-sdk-provider'),
    creatorFunctionName: 'createOpenRouter',
    supportsImageGeneration: true,
    aliases: ['openrouter']
  },
  {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    import: () => import('@ai-sdk/google-vertex/edge'),
    creatorFunctionName: 'createVertex',
    supportsImageGeneration: true,
    aliases: ['vertexai']
  },
  {
    id: 'google-vertex-anthropic',
    name: 'Google Vertex AI Anthropic',
    import: () => import('@ai-sdk/google-vertex/anthropic/edge'),
    creatorFunctionName: 'createVertexAnthropic',
    supportsImageGeneration: true,
    aliases: ['vertexai-anthropic']
  },
  {
    id: 'github-copilot-openai-compatible',
    name: 'GitHub Copilot OpenAI Compatible',
    import: () => import('@opeoginni/github-copilot-openai-compatible'),
    creatorFunctionName: 'createGitHubCopilotOpenAICompatible',
    supportsImageGeneration: false,
    aliases: ['copilot', 'github-copilot']
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    import: () => import('@ai-sdk/amazon-bedrock'),
    creatorFunctionName: 'createAmazonBedrock',
    supportsImageGeneration: true,
    aliases: ['aws-bedrock']
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    import: () => import('@ai-sdk/perplexity'),
    creatorFunctionName: 'createPerplexity',
    supportsImageGeneration: false,
    aliases: ['perplexity']
  }
] as const

/**
 * 初始化新的Providers
 * 使用aiCore的动态注册功能
 */
export async function initializeNewProviders(): Promise<void> {
  try {
    const successCount = registerMultipleProviderConfigs(NEW_PROVIDER_CONFIGS)
    if (successCount < NEW_PROVIDER_CONFIGS.length) {
      logger.warn('Some providers failed to register. Check previous error logs.')
    }
  } catch (error) {
    logger.error('Failed to initialize new providers:', error as Error)
  }
}
