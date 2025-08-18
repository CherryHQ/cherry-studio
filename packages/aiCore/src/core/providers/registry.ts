/**
 * AI Provider 注册表
 * 静态类型 + 动态导入模式：所有类型静态导入，所有实现动态导入
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createXai } from '@ai-sdk/xai'

import { type ProviderConfig } from './types'

export class AiProviderRegistry {
  private static instance: AiProviderRegistry
  private registry = new Map<string, ProviderConfig>()
  // 动态注册扩展
  private dynamicMappings = new Map<string, string>()
  private dynamicProviders = new Set<string>()

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
   * 基于 AI SDK 官方文档: https://v5.ai-sdk.dev/providers/ai-sdk-providers
   */
  private initializeProviders(): void {
    const providers: ProviderConfig[] = [
      {
        id: 'openai',
        name: 'OpenAI',
        creator: createOpenAI,
        supportsImageGeneration: true
      },
      {
        id: 'openai-responses',
        name: 'OpenAI Responses',
        creator: (options: OpenAIProviderSettings) => {
          return createOpenAI(options).responses
        },
        supportsImageGeneration: true
      },
      {
        id: 'openai-compatible',
        name: 'OpenAI Compatible',
        creator: createOpenAICompatible,
        supportsImageGeneration: true
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        creator: createAnthropic,
        supportsImageGeneration: false
      },
      {
        id: 'google',
        name: 'Google Generative AI',
        creator: createGoogleGenerativeAI,
        supportsImageGeneration: true
      },
      {
        id: 'xai',
        name: 'xAI (Grok)',
        creator: createXai,
        supportsImageGeneration: true
      },
      {
        id: 'azure',
        name: 'Azure OpenAI',
        creator: createAzure,
        supportsImageGeneration: true
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        creator: createDeepSeek,
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
    return this.registry.get(id) || this.registry.get('openai-compatible')
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
    // 验证：必须提供 creator 或 (import + creatorFunctionName)
    if (!config.creator && !(config.import && config.creatorFunctionName)) {
      throw new Error('Must provide either creator function or import configuration')
    }

    // 验证：不能同时提供两种方式
    if (config.creator && config.import) {
      console.warn('Both creator and import provided, creator will take precedence')
    }

    this.registry.set(config.id, config)
  }

  /**
   * 动态注册Provider并支持映射关系
   */
  public registerDynamicProvider(
    config: ProviderConfig & {
      mappings?: Record<string, string>
    }
  ): boolean {
    try {
      // 验证配置
      if (!config.id || config.id.trim() === '') {
        console.error('Provider ID cannot be empty')
        return false
      }

      // 注册provider
      this.registerProvider(config)

      // 记录为动态provider
      this.dynamicProviders.add(config.id)

      // 添加映射关系（如果提供）
      if (config.mappings) {
        Object.entries(config.mappings).forEach(([key, value]) => {
          this.dynamicMappings.set(key, value)
        })
      }

      return true
    } catch (error) {
      console.error(`Failed to register provider ${config.id}:`, error)
      return false
    }
  }

  /**
   * 批量注册多个动态Providers
   */
  public registerMultipleProviders(
    configs: (ProviderConfig & {
      mappings?: Record<string, string>
    })[]
  ): number {
    let successCount = 0
    configs.forEach((config) => {
      if (this.registerDynamicProvider(config)) {
        successCount++
      }
    })
    return successCount
  }

  /**
   * 获取Provider映射（包括动态映射）
   */
  public getProviderMapping(providerId: string): string | undefined {
    return this.dynamicMappings.get(providerId) || (this.dynamicProviders.has(providerId) ? providerId : undefined)
  }

  /**
   * 检查是否为动态注册的Provider
   */
  public isDynamicProvider(providerId: string): boolean {
    return this.dynamicProviders.has(providerId)
  }

  /**
   * 获取所有动态Provider映射
   */
  public getAllDynamicMappings(): Record<string, string> {
    return Object.fromEntries(this.dynamicMappings)
  }

  /**
   * 获取所有动态注册的Providers
   */
  public getDynamicProviders(): string[] {
    return Array.from(this.dynamicProviders)
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.registry.clear()
  }
}

// 导出单例实例
export const aiProviderRegistry = AiProviderRegistry.getInstance()

// 便捷函数
export const getProvider = (id: string) => aiProviderRegistry.getProvider(id)
export const getAllProviders = () => aiProviderRegistry.getAllProviders()
export const isProviderSupported = (id: string) => aiProviderRegistry.isSupported(id)
export const registerProvider = (config: ProviderConfig) => aiProviderRegistry.registerProvider(config)

// 动态注册相关便捷函数
export const registerDynamicProvider = (config: ProviderConfig & { mappings?: Record<string, string> }) =>
  aiProviderRegistry.registerDynamicProvider(config)
export const registerMultipleProviders = (configs: (ProviderConfig & { mappings?: Record<string, string> })[]) =>
  aiProviderRegistry.registerMultipleProviders(configs)
export const getProviderMapping = (providerId: string) => aiProviderRegistry.getProviderMapping(providerId)
export const isDynamicProvider = (providerId: string) => aiProviderRegistry.isDynamicProvider(providerId)
export const getAllDynamicMappings = () => aiProviderRegistry.getAllDynamicMappings()
export const getDynamicProviders = () => aiProviderRegistry.getDynamicProviders()

// 兼容现有实现的导出
// export const PROVIDER_REGISTRY = aiProviderRegistry.getCompatibleRegistry()
