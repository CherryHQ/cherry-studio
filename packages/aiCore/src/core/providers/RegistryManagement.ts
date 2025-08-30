/**
 * Provider 注册表管理器
 * 纯粹的管理功能：存储、检索已配置好的 provider 实例
 * 基于 AI SDK 原生的 createProviderRegistry
 */

import { EmbeddingModelV2, ImageModelV2, LanguageModelV2, ProviderV2 } from '@ai-sdk/provider'
import { createProviderRegistry, type ProviderRegistryProvider } from 'ai'

type PROVIDERS = Record<string, ProviderV2>

export const DEFAULT_SEPARATOR = '|'

// export type MODEL_ID = `${string}${typeof DEFAULT_SEPARATOR}${string}`

export class RegistryManagement<SEPARATOR extends string = typeof DEFAULT_SEPARATOR> {
  private providers: PROVIDERS = {}
  private aliases: Set<string> = new Set() // 记录哪些key是别名
  private separator: SEPARATOR
  private registry: ProviderRegistryProvider<PROVIDERS, SEPARATOR> | null = null

  constructor(options: { separator: SEPARATOR } = { separator: DEFAULT_SEPARATOR as SEPARATOR }) {
    this.separator = options.separator
  }

  /**
   * 注册已配置好的 provider 实例
   */
  registerProvider(id: string, provider: ProviderV2, aliases?: string[]): this {
    // 注册主provider
    this.providers[id] = provider

    // 注册别名（都指向同一个provider实例）
    if (aliases) {
      aliases.forEach((alias) => {
        this.providers[alias] = provider // 直接存储引用
        this.aliases.add(alias) // 标记为别名
      })
    }

    this.rebuildRegistry()
    return this
  }

  /**
   * 获取已注册的provider实例
   */
  getProvider(id: string): ProviderV2 | undefined {
    return this.providers[id]
  }

  /**
   * 批量注册 providers
   */
  registerProviders(providers: Record<string, ProviderV2>): this {
    Object.assign(this.providers, providers)
    this.rebuildRegistry()
    return this
  }

  /**
   * 移除 provider（同时清理相关别名）
   */
  unregisterProvider(id: string): this {
    const provider = this.providers[id]
    if (!provider) return this

    // 如果移除的是真实ID，需要清理所有指向它的别名
    if (!this.aliases.has(id)) {
      // 找到所有指向此provider的别名并删除
      const aliasesToRemove: string[] = []
      this.aliases.forEach((alias) => {
        if (this.providers[alias] === provider) {
          aliasesToRemove.push(alias)
        }
      })

      aliasesToRemove.forEach((alias) => {
        delete this.providers[alias]
        this.aliases.delete(alias)
      })
    } else {
      // 如果移除的是别名，只删除别名记录
      this.aliases.delete(id)
    }

    delete this.providers[id]
    this.rebuildRegistry()
    return this
  }

  /**
   * 立即重建 registry - 每次变更都重建
   */
  private rebuildRegistry(): void {
    if (Object.keys(this.providers).length === 0) {
      this.registry = null
      return
    }

    this.registry = createProviderRegistry<PROVIDERS, SEPARATOR>(this.providers, {
      separator: this.separator
    })
  }

  /**
   * 获取语言模型 - AI SDK 原生方法
   */
  languageModel(id: `${string}${SEPARATOR}${string}`): LanguageModelV2 {
    if (!this.registry) {
      throw new Error('No providers registered')
    }
    return this.registry.languageModel(id)
  }

  /**
   * 获取文本嵌入模型 - AI SDK 原生方法
   */
  textEmbeddingModel(id: `${string}${SEPARATOR}${string}`): EmbeddingModelV2<string> {
    if (!this.registry) {
      throw new Error('No providers registered')
    }
    return this.registry.textEmbeddingModel(id)
  }

  /**
   * 获取图像模型 - AI SDK 原生方法
   */
  imageModel(id: `${string}${SEPARATOR}${string}`): ImageModelV2 {
    if (!this.registry) {
      throw new Error('No providers registered')
    }
    return this.registry.imageModel(id)
  }

  /**
   * 获取转录模型 - AI SDK 原生方法
   */
  transcriptionModel(id: `${string}${SEPARATOR}${string}`): any {
    if (!this.registry) {
      throw new Error('No providers registered')
    }
    return this.registry.transcriptionModel(id)
  }

  /**
   * 获取语音模型 - AI SDK 原生方法
   */
  speechModel(id: `${string}${SEPARATOR}${string}`): any {
    if (!this.registry) {
      throw new Error('No providers registered')
    }
    return this.registry.speechModel(id)
  }

  /**
   * 获取已注册的 provider 列表
   */
  getRegisteredProviders(): string[] {
    return Object.keys(this.providers)
  }

  /**
   * 检查是否有已注册的 providers
   */
  hasProviders(): boolean {
    return Object.keys(this.providers).length > 0
  }

  /**
   * 清除所有 providers
   */
  clear(): this {
    this.providers = {}
    this.aliases.clear()
    this.registry = null
    return this
  }

  /**
   * 解析真实的Provider ID（供getAiSdkProviderId使用）
   * 如果传入的是别名，返回真实的Provider ID
   * 如果传入的是真实ID，直接返回
   */
  resolveProviderId(id: string): string {
    if (!this.aliases.has(id)) return id // 不是别名，直接返回

    // 是别名，找到真实ID
    const targetProvider = this.providers[id]
    for (const [realId, provider] of Object.entries(this.providers)) {
      if (provider === targetProvider && !this.aliases.has(realId)) {
        return realId
      }
    }
    return id
  }

  /**
   * 检查是否为别名
   */
  isAlias(id: string): boolean {
    return this.aliases.has(id)
  }

  /**
   * 获取所有别名映射关系
   */
  getAllAliases(): Record<string, string> {
    const result: Record<string, string> = {}
    this.aliases.forEach((alias) => {
      result[alias] = this.resolveProviderId(alias)
    })
    return result
  }
}

/**
 * 全局注册表管理器实例
 * 使用 | 作为分隔符，因为 : 会和 :free 等suffix冲突
 */
export const globalRegistryManagement = new RegistryManagement()
