/**
 * AI Provider 注册表
 * 静态类型 + 动态导入模式：所有类型静态导入，所有实现动态导入
 */

// 静态导入所有 AI SDK 类型
import { type AmazonBedrockProviderSettings } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderSettings } from '@ai-sdk/anthropic'
import { type AzureOpenAIProviderSettings } from '@ai-sdk/azure'
import { type CerebrasProviderSettings } from '@ai-sdk/cerebras'
import { type CohereProviderSettings } from '@ai-sdk/cohere'
import { type DeepInfraProviderSettings } from '@ai-sdk/deepinfra'
import { type DeepSeekProviderSettings } from '@ai-sdk/deepseek'
import { type FalProviderSettings } from '@ai-sdk/fal'
import { type FireworksProviderSettings } from '@ai-sdk/fireworks'
import { type GoogleGenerativeAIProviderSettings } from '@ai-sdk/google'
import { type GoogleVertexProviderSettings } from '@ai-sdk/google-vertex/edge'
import { type GroqProviderSettings } from '@ai-sdk/groq'
import { type MistralProviderSettings } from '@ai-sdk/mistral'
import { type OpenAIProviderSettings } from '@ai-sdk/openai'
import { type OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import { type PerplexityProviderSettings } from '@ai-sdk/perplexity'
import { type ReplicateProviderSettings } from '@ai-sdk/replicate'
import { type TogetherAIProviderSettings } from '@ai-sdk/togetherai'
import { type VercelProviderSettings } from '@ai-sdk/vercel'
import { type XaiProviderSettings } from '@ai-sdk/xai'
import { type OpenRouterProviderSettings } from '@openrouter/ai-sdk-provider'
import { type AnthropicVertexProviderSettings } from 'anthropic-vertex-ai'
import { type OllamaProviderSettings } from 'ollama-ai-provider'

// 类型安全的 Provider Settings 映射
export type ProviderSettingsMap = {
  openai: OpenAIProviderSettings
  'openai-compatible': OpenAICompatibleProviderSettings
  openrouter: OpenRouterProviderSettings
  anthropic: AnthropicProviderSettings
  google: GoogleGenerativeAIProviderSettings
  'google-vertex': GoogleVertexProviderSettings
  mistral: MistralProviderSettings
  xai: XaiProviderSettings
  azure: AzureOpenAIProviderSettings
  bedrock: AmazonBedrockProviderSettings
  cohere: CohereProviderSettings
  groq: GroqProviderSettings
  together: TogetherAIProviderSettings
  fireworks: FireworksProviderSettings
  deepseek: DeepSeekProviderSettings
  cerebras: CerebrasProviderSettings
  deepinfra: DeepInfraProviderSettings
  replicate: ReplicateProviderSettings
  perplexity: PerplexityProviderSettings
  fal: FalProviderSettings
  vercel: VercelProviderSettings
  ollama: OllamaProviderSettings
  'anthropic-vertex': AnthropicVertexProviderSettings
}

export type ProviderId = keyof ProviderSettingsMap & string

// 统一的 Provider 配置接口（所有都使用动态导入）
export interface ProviderConfig {
  id: string
  name: string
  // 动态导入函数
  import: () => Promise<any>
  // 创建函数名称
  creatorFunctionName: string
  // 是否支持图片生成
  supportsImageGeneration?: boolean
}

/**
 * AI SDK Provider 注册表
 * 管理所有支持的 AI Providers 及其动态导入
 */
export class AiProviderRegistry {
  private static instance: AiProviderRegistry
  private registry = new Map<string, ProviderConfig>()

  private constructor() {
    this.initializeProviders()
  }

  public static getInstance(): AiProviderRegistry {
    if (!AiProviderRegistry.instance) {
      AiProviderRegistry.instance = new AiProviderRegistry()
    }
    return AiProviderRegistry.instance
  }

  /**
   * 初始化所有支持的 Providers
   * 基于 AI SDK 官方文档: https://ai-sdk.dev/providers/ai-sdk-providers
   */
  private initializeProviders(): void {
    const providers: ProviderConfig[] = [
      // 官方 AI SDK Providers (19个)
      {
        id: 'openai',
        name: 'OpenAI',
        import: () => import('@ai-sdk/openai'),
        creatorFunctionName: 'createOpenAI',
        supportsImageGeneration: true
      },
      {
        id: 'openai-compatible',
        name: 'OpenAI Compatible',
        import: () => import('@ai-sdk/openai-compatible'),
        creatorFunctionName: 'createOpenAICompatible',
        supportsImageGeneration: true
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        import: () => import('@ai-sdk/anthropic'),
        creatorFunctionName: 'createAnthropic',
        supportsImageGeneration: false
      },
      {
        id: 'google',
        name: 'Google Generative AI',
        import: () => import('@ai-sdk/google'),
        creatorFunctionName: 'createGoogleGenerativeAI',
        supportsImageGeneration: true
      },
      {
        id: 'google-vertex',
        name: 'Google Vertex AI',
        import: () => import('@ai-sdk/google-vertex/edge'),
        creatorFunctionName: 'createVertex',
        supportsImageGeneration: true
      },
      {
        id: 'mistral',
        name: 'Mistral AI',
        import: () => import('@ai-sdk/mistral'),
        creatorFunctionName: 'createMistral',
        supportsImageGeneration: false
      },
      {
        id: 'xai',
        name: 'xAI (Grok)',
        import: () => import('@ai-sdk/xai'),
        creatorFunctionName: 'createXai',
        supportsImageGeneration: true
      },
      {
        id: 'azure',
        name: 'Azure OpenAI',
        import: () => import('@ai-sdk/azure'),
        creatorFunctionName: 'createAzure',
        supportsImageGeneration: true
      },
      {
        id: 'bedrock',
        name: 'Amazon Bedrock',
        import: () => import('@ai-sdk/amazon-bedrock'),
        creatorFunctionName: 'createAmazonBedrock',
        supportsImageGeneration: false
      },
      {
        id: 'cohere',
        name: 'Cohere',
        import: () => import('@ai-sdk/cohere'),
        creatorFunctionName: 'createCohere',
        supportsImageGeneration: false
      },
      {
        id: 'groq',
        name: 'Groq',
        import: () => import('@ai-sdk/groq'),
        creatorFunctionName: 'createGroq',
        supportsImageGeneration: false
      },
      {
        id: 'together',
        name: 'Together.ai',
        import: () => import('@ai-sdk/togetherai'),
        creatorFunctionName: 'createTogetherAI',
        supportsImageGeneration: true
      },
      {
        id: 'fireworks',
        name: 'Fireworks',
        import: () => import('@ai-sdk/fireworks'),
        creatorFunctionName: 'createFireworks',
        supportsImageGeneration: true
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        import: () => import('@ai-sdk/deepseek'),
        creatorFunctionName: 'createDeepSeek',
        supportsImageGeneration: false
      },
      {
        id: 'cerebras',
        name: 'Cerebras',
        import: () => import('@ai-sdk/cerebras'),
        creatorFunctionName: 'createCerebras',
        supportsImageGeneration: false
      },
      {
        id: 'deepinfra',
        name: 'DeepInfra',
        import: () => import('@ai-sdk/deepinfra'),
        creatorFunctionName: 'createDeepInfra',
        supportsImageGeneration: false
      },
      {
        id: 'replicate',
        name: 'Replicate',
        import: () => import('@ai-sdk/replicate'),
        creatorFunctionName: 'createReplicate',
        supportsImageGeneration: true
      },
      {
        id: 'perplexity',
        name: 'Perplexity',
        import: () => import('@ai-sdk/perplexity'),
        creatorFunctionName: 'createPerplexity',
        supportsImageGeneration: false
      },
      {
        id: 'fal',
        name: 'Fal AI',
        import: () => import('@ai-sdk/fal'),
        creatorFunctionName: 'createFal',
        supportsImageGeneration: false
      },
      {
        id: 'vercel',
        name: 'Vercel',
        import: () => import('@ai-sdk/vercel'),
        creatorFunctionName: 'createVercel'
      },

      // 社区 Providers (5个)
      {
        id: 'ollama',
        name: 'Ollama',
        import: () => import('ollama-ai-provider'),
        creatorFunctionName: 'createOllama',
        supportsImageGeneration: false
      },
      {
        id: 'anthropic-vertex',
        name: 'Anthropic Vertex AI',
        import: () => import('anthropic-vertex-ai'),
        creatorFunctionName: 'createAnthropicVertex',
        supportsImageGeneration: false
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        import: () => import('@openrouter/ai-sdk-provider'),
        creatorFunctionName: 'createOpenRouter',
        supportsImageGeneration: false
      }
    ]

    providers.forEach((config) => {
      this.registry.set(config.id, config)
    })
  }

  /**
   * 获取所有已注册的 Providers
   */
  public getAllProviders(): ProviderConfig[] {
    return Array.from(this.registry.values())
  }

  /**
   * 根据 ID 获取 Provider 配置
   */
  public getProvider(id: string): ProviderConfig | undefined {
    return this.registry.get(id)
  }

  /**
   * 检查 Provider 是否支持（是否已注册）
   */
  public isSupported(id: string): boolean {
    return this.registry.has(id)
  }

  /**
   * 注册新的 Provider（用于扩展）
   */
  public registerProvider(config: ProviderConfig): void {
    this.registry.set(config.id, config)
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.registry.clear()
  }

  /**
   * 获取兼容现有实现的注册表格式
   */
  public getCompatibleRegistry(): Record<string, { import: () => Promise<any>; creatorFunctionName: string }> {
    const compatibleRegistry: Record<string, { import: () => Promise<any>; creatorFunctionName: string }> = {}

    this.getAllProviders().forEach((provider) => {
      compatibleRegistry[provider.id] = {
        import: provider.import,
        creatorFunctionName: provider.creatorFunctionName
      }
    })

    return compatibleRegistry
  }
}

// 导出单例实例
export const aiProviderRegistry = AiProviderRegistry.getInstance()

// 便捷函数
export const getProvider = (id: string) => aiProviderRegistry.getProvider(id)
export const getAllProviders = () => aiProviderRegistry.getAllProviders()
export const isProviderSupported = (id: string) => aiProviderRegistry.isSupported(id)
export const registerProvider = (config: ProviderConfig) => aiProviderRegistry.registerProvider(config)

// 兼容现有实现的导出
export const PROVIDER_REGISTRY = aiProviderRegistry.getCompatibleRegistry()

// 重新导出所有类型供外部使用
export type {
  AmazonBedrockProviderSettings,
  AnthropicProviderSettings,
  AnthropicVertexProviderSettings,
  AzureOpenAIProviderSettings,
  CerebrasProviderSettings,
  CohereProviderSettings,
  DeepInfraProviderSettings,
  DeepSeekProviderSettings,
  FalProviderSettings,
  FireworksProviderSettings,
  GoogleGenerativeAIProviderSettings,
  GoogleVertexProviderSettings,
  GroqProviderSettings,
  MistralProviderSettings,
  OllamaProviderSettings,
  OpenAICompatibleProviderSettings,
  OpenAIProviderSettings,
  OpenRouterProviderSettings,
  PerplexityProviderSettings,
  ReplicateProviderSettings,
  TogetherAIProviderSettings,
  VercelProviderSettings,
  XaiProviderSettings
}
