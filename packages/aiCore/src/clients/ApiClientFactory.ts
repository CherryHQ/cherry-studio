/**
 * API Client Factory
 * 整合现有实现的改进版API客户端工厂
 */

import type { ImageModelV1 } from '@ai-sdk/provider'
import { type LanguageModelV1, LanguageModelV1Middleware, wrapLanguageModel } from 'ai'

import { aiProviderRegistry } from '../providers/registry'
import { type ProviderId, type ProviderSettingsMap } from './types'

// 客户端配置接口
export interface ClientConfig {
  providerId: string
  options?: any
}

// 错误类型
export class ClientFactoryError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ClientFactoryError'
  }
}

/**
 * API Client Factory
 * 统一管理和创建AI SDK客户端
 */
export class ApiClientFactory {
  /**
   * 创建 AI SDK 模型实例
   * 对于已知的 Provider 使用严格类型检查，未知的 Provider 默认使用 openai-compatible
   */
  static async createClient<T extends ProviderId>(
    providerId: T,
    modelId: string,
    options: ProviderSettingsMap[T],
    middlewares?: LanguageModelV1Middleware[]
  ): Promise<LanguageModelV1>

  static async createClient(
    providerId: string,
    modelId: string,
    options: ProviderSettingsMap['openai-compatible'],
    middlewares?: LanguageModelV1Middleware[]
  ): Promise<LanguageModelV1>

  static async createClient(
    providerId: string,
    modelId: string = 'default',
    options: any,
    middlewares?: LanguageModelV1Middleware[]
  ): Promise<LanguageModelV1> {
    try {
      // 对于不在注册表中的 provider，默认使用 openai-compatible
      const effectiveProviderId = aiProviderRegistry.isSupported(providerId) ? providerId : 'openai-compatible'

      // 获取Provider配置
      const providerConfig = aiProviderRegistry.getProvider(effectiveProviderId)
      if (!providerConfig) {
        throw new ClientFactoryError(`Provider "${effectiveProviderId}" is not registered`, providerId)
      }

      // 动态导入模块
      const module = await providerConfig.import()

      // 获取创建函数
      const creatorFunction = module[providerConfig.creatorFunctionName]

      if (typeof creatorFunction !== 'function') {
        throw new ClientFactoryError(
          `Creator function "${providerConfig.creatorFunctionName}" not found in the imported module for provider "${effectiveProviderId}"`
        )
      }
      // 创建provider实例
      const provider = creatorFunction(options)

      // 返回模型实例
      if (typeof provider === 'function') {
        let model: LanguageModelV1 = provider(modelId)

        // 应用 AI SDK 中间件
        if (middlewares && middlewares.length > 0) {
          model = wrapLanguageModel({
            model: model,
            middleware: middlewares
          })
        }

        return model
      } else {
        throw new ClientFactoryError(`Unknown model access pattern for provider "${effectiveProviderId}"`)
      }
    } catch (error) {
      if (error instanceof ClientFactoryError) {
        throw error
      }
      throw new ClientFactoryError(
        `Failed to create client for provider "${providerId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        providerId,
        error instanceof Error ? error : undefined
      )
    }
  }

  static async createImageClient<T extends ProviderId>(
    providerId: T,
    modelId: string,
    options: ProviderSettingsMap[T]
  ): Promise<ImageModelV1>

  static async createImageClient(
    providerId: string,
    modelId: string,
    options: ProviderSettingsMap['openai-compatible']
  ): Promise<ImageModelV1>

  static async createImageClient(providerId: string, modelId: string = 'default', options: any): Promise<ImageModelV1> {
    try {
      if (!aiProviderRegistry.isSupported(providerId)) {
        throw new ClientFactoryError(`Provider "${providerId}" is not supported`, providerId)
      }

      const providerConfig = aiProviderRegistry.getProvider(providerId)
      if (!providerConfig) {
        throw new ClientFactoryError(`Provider "${providerId}" is not registered`, providerId)
      }

      if (!providerConfig.supportsImageGeneration) {
        throw new ClientFactoryError(`Provider "${providerId}" does not support image generation`, providerId)
      }

      const module = await providerConfig.import()

      const creatorFunction = module[providerConfig.creatorFunctionName]

      if (typeof creatorFunction !== 'function') {
        throw new ClientFactoryError(
          `Creator function "${providerConfig.creatorFunctionName}" not found in the imported module for provider "${providerId}"`
        )
      }

      const provider = creatorFunction(options)

      if (provider && typeof provider.image === 'function') {
        return provider.image(modelId)
      } else {
        throw new ClientFactoryError(`Image model function not found for provider "${providerId}"`)
      }
    } catch (error) {
      if (error instanceof ClientFactoryError) {
        throw error
      }
      throw new ClientFactoryError(
        `Failed to create image client for provider "${providerId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        providerId,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * 获取支持的 Providers 列表
   */
  static getSupportedProviders(): Array<{
    id: string
    name: string
  }> {
    return aiProviderRegistry.getAllProviders().map((provider) => ({
      id: provider.id,
      name: provider.name
    }))
  }

  /**
   * 获取 Provider 信息
   */
  static getClientInfo(providerId: string): {
    id: string
    name: string
    isSupported: boolean
    effectiveProvider: string
  } {
    const effectiveProviderId = aiProviderRegistry.isSupported(providerId) ? providerId : 'openai-compatible'
    const provider = aiProviderRegistry.getProvider(effectiveProviderId)

    return {
      id: providerId,
      name: provider?.name || providerId,
      isSupported: aiProviderRegistry.isSupported(providerId),
      effectiveProvider: effectiveProviderId
    }
  }
}

// 便捷导出函数
export function createClient<T extends ProviderId>(
  providerId: T,
  modelId: string,
  options: ProviderSettingsMap[T]
): Promise<LanguageModelV1>

export function createClient(
  providerId: string,
  modelId: string,
  options: ProviderSettingsMap['openai-compatible']
): Promise<LanguageModelV1>

export function createClient(providerId: string, modelId: string = 'default', options: any): Promise<LanguageModelV1> {
  return ApiClientFactory.createClient(providerId, modelId, options)
}

export const createImageClient = (providerId: string, modelId: string, options: any): Promise<ImageModelV1> =>
  ApiClientFactory.createImageClient(providerId, modelId, options)

export const getSupportedProviders = () => ApiClientFactory.getSupportedProviders()

export const getClientInfo = (providerId: string) => ApiClientFactory.getClientInfo(providerId)
