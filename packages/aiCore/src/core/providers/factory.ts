/**
 * AI Provider 配置工厂
 * 提供类型安全的 Provider 配置构建器
 */

import type { ProviderId, ProviderSettingsMap } from './types'

/**
 * 通用配置基础类型，包含所有 Provider 共有的属性
 */
export interface BaseProviderConfig {
  apiKey?: string
  baseURL?: string
  timeout?: number
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

/**
 * 完整的配置类型，结合基础配置、AI SDK 配置和特定 Provider 配置
 */
type CompleteProviderConfig<T extends ProviderId> = BaseProviderConfig & Partial<ProviderSettingsMap[T]>

type ConfigHandler<T extends ProviderId> = (
  builder: ProviderConfigBuilder<T>,
  provider: CompleteProviderConfig<T>
) => void

const configHandlers: {
  [K in ProviderId]?: ConfigHandler<K>
} = {
  azure: (builder, provider) => {
    const azureBuilder = builder as ProviderConfigBuilder<'azure'>
    const azureProvider = provider as CompleteProviderConfig<'azure'>
    azureBuilder.withAzureConfig({
      apiVersion: azureProvider.apiVersion,
      resourceName: azureProvider.resourceName
    })
  }
}

export class ProviderConfigBuilder<T extends ProviderId = ProviderId> {
  private config: CompleteProviderConfig<T> = {} as CompleteProviderConfig<T>

  constructor(private providerId: T) {}

  /**
   * 设置 API Key
   */
  withApiKey(apiKey: string): this
  withApiKey(apiKey: string, options: T extends 'openai' ? { organization?: string; project?: string } : never): this
  withApiKey(apiKey: string, options?: any): this {
    this.config.apiKey = apiKey

    // 类型安全的 OpenAI 特定配置
    if (this.providerId === 'openai' && options) {
      const openaiConfig = this.config as CompleteProviderConfig<'openai'>
      if (options.organization) {
        openaiConfig.organization = options.organization
      }
      if (options.project) {
        openaiConfig.project = options.project
      }
    }

    return this
  }

  /**
   * 设置基础 URL
   */
  withBaseURL(baseURL: string) {
    this.config.baseURL = baseURL
    return this
  }

  /**
   * 设置请求配置
   */
  withRequestConfig(options: { headers?: Record<string, string>; fetch?: typeof fetch }): this {
    if (options.headers) {
      this.config.headers = { ...this.config.headers, ...options.headers }
    }
    if (options.fetch) {
      this.config.fetch = options.fetch
    }
    return this
  }

  /**
   * Azure OpenAI 特定配置
   */
  withAzureConfig(options: { apiVersion?: string; resourceName?: string }): T extends 'azure' ? this : never
  withAzureConfig(options: any): any {
    if (this.providerId === 'azure') {
      const azureConfig = this.config as CompleteProviderConfig<'azure'>
      if (options.apiVersion) {
        azureConfig.apiVersion = options.apiVersion
      }
      if (options.resourceName) {
        azureConfig.resourceName = options.resourceName
      }
    }
    return this
  }

  /**
   * 设置自定义参数
   */
  withCustomParams(params: Record<string, any>) {
    Object.assign(this.config, params)
    return this
  }

  /**
   * 构建最终配置
   */
  build(): ProviderSettingsMap[T] {
    return this.config as ProviderSettingsMap[T]
  }
}

/**
 * Provider 配置工厂
 * 提供便捷的配置创建方法
 */
export class ProviderConfigFactory {
  /**
   * 创建配置构建器
   */
  static builder<T extends ProviderId>(providerId: T): ProviderConfigBuilder<T> {
    return new ProviderConfigBuilder(providerId)
  }

  /**
   * 从通用Provider对象创建配置 - 使用更优雅的处理器模式
   */
  static fromProvider<T extends ProviderId>(
    providerId: T,
    provider: CompleteProviderConfig<T>,
    options?: {
      headers?: Record<string, string>
      [key: string]: any
    }
  ): ProviderSettingsMap[T] {
    const builder = new ProviderConfigBuilder<T>(providerId)

    // 设置基本配置
    if (provider.apiKey) {
      builder.withApiKey(provider.apiKey)
    }

    if (provider.baseURL) {
      builder.withBaseURL(provider.baseURL)
    }

    // 设置请求配置
    if (options?.headers) {
      builder.withRequestConfig({
        headers: options.headers
      })
    }

    // 使用配置处理器模式 - 更加优雅和可扩展
    const handler = configHandlers[providerId]
    if (handler) {
      handler(builder, provider)
    }

    // 添加其他自定义参数
    if (options) {
      const customOptions = { ...options }
      delete customOptions.headers // 已经处理过了
      if (Object.keys(customOptions).length > 0) {
        builder.withCustomParams(customOptions)
      }
    }

    return builder.build()
  }

  /**
   * 快速创建 OpenAI 配置
   */
  static createOpenAI(
    apiKey: string,
    options?: {
      baseURL?: string
      organization?: string
      project?: string
    }
  ) {
    const builder = this.builder('openai')

    // 使用类型安全的重载
    if (options?.organization || options?.project) {
      builder.withApiKey(apiKey, {
        organization: options.organization,
        project: options.project
      })
    } else {
      builder.withApiKey(apiKey)
    }

    return builder.withBaseURL(options?.baseURL || 'https://api.openai.com').build()
  }

  /**
   * 快速创建 Anthropic 配置
   */
  static createAnthropic(
    apiKey: string,
    options?: {
      baseURL?: string
    }
  ) {
    return this.builder('anthropic')
      .withApiKey(apiKey)
      .withBaseURL(options?.baseURL || 'https://api.anthropic.com')
      .build()
  }

  /**
   * 快速创建 Azure OpenAI 配置
   */
  static createAzureOpenAI(
    apiKey: string,
    options: {
      baseURL: string
      apiVersion?: string
      resourceName?: string
    }
  ) {
    return this.builder('azure')
      .withApiKey(apiKey)
      .withBaseURL(options.baseURL)
      .withAzureConfig({
        apiVersion: options.apiVersion,
        resourceName: options.resourceName
      })
      .build()
  }

  /**
   * 快速创建 Google 配置
   */
  static createGoogle(
    apiKey: string,
    options?: {
      baseURL?: string
      projectId?: string
      location?: string
    }
  ) {
    return this.builder('google')
      .withApiKey(apiKey)
      .withBaseURL(options?.baseURL || 'https://generativelanguage.googleapis.com')
      .build()
  }

  /**
   * 快速创建 Vertex AI 配置
   */
  static createVertexAI() {
    // credentials: {
    //   clientEmail: string
    //   privateKey: string
    // },
    // options?: {
    //   project?: string
    //   location?: string
    // }
    // return this.builder('google-vertex')
    //   .withGoogleCredentials(credentials)
    //   .withGoogleVertexConfig({
    //     project: options?.project,
    //     location: options?.location
    //   })
    //   .build()
  }

  static createOpenAICompatible(baseURL: string, apiKey: string) {
    return this.builder('openai-compatible').withBaseURL(baseURL).withApiKey(apiKey).build()
  }
}

/**
 * 便捷的配置创建函数
 */
export const createProviderConfig = ProviderConfigFactory.fromProvider
export const providerConfigBuilder = ProviderConfigFactory.builder
