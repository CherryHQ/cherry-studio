import type { ProviderV3 } from '@ai-sdk/provider'
import { LRUCache } from 'lru-cache'

import { deepMergeObjects } from '../../utils'
import type { ProviderVariant, ToolFactoryMap } from '../types'

export type ProviderCreatorFunction<TSettings = any> = (settings?: TSettings) => ProviderV3 | Promise<ProviderV3>

/**
 * Provider 模块类型
 * 动态导入的模块应该包含至少一个创建函数
 * 允许 default 导出和其他属性
 */
export type ProviderModule<TSettings = any> = Record<string, any> & {
  [K: string]: ProviderCreatorFunction<TSettings> | any
}

/**
 * Provider Extension 配置基础接口
 *
 * @typeParam TSettings - Provider 配置类型
 * @typeParam TProvider - 实际 provider 类型（用于 variants）
 * @typeParam TName - Provider 名称类型（用于字面量推导）
 */
interface ProviderExtensionConfigBase<
  TSettings = any,
  TProvider extends ProviderV3 = ProviderV3,
  TName extends string = string
> {
  /** Provider 唯一标识 */
  name: TName

  /** 别名列表（可选） */
  aliases?: readonly string[]

  /** 默认配置选项 */
  defaultOptions?: Partial<TSettings>

  /** 是否支持图像生成 */
  supportsImageGeneration?: boolean

  /**
   * Provider 变体配置
   * 用于注册同一 provider 的不同模式
   */
  variants?: readonly ProviderVariant<TSettings, TProvider>[]

  /**
   * Tool factory 映射
   * 声明该 provider 支持的工具能力（如 webSearch）
   * 工具工厂从 provider 实例的 .tools 属性提取
   */
  toolFactories?: ToolFactoryMap<TProvider>
}

/**
 * Provider Extension 配置接口 - 使用 create 函数
 */
interface ProviderExtensionConfigWithCreate<
  TSettings = any,
  TProvider extends ProviderV3 = ProviderV3,
  TName extends string = string
> extends ProviderExtensionConfigBase<TSettings, TProvider, TName> {
  create: ProviderCreatorFunction<TSettings>

  import?: never

  creatorFunctionName?: never
}

/**
 * Provider Extension 配置接口 - 使用动态导入
 */
interface ProviderExtensionConfigWithImport<
  TSettings = any,
  TProvider extends ProviderV3 = ProviderV3,
  TName extends string = string
> extends ProviderExtensionConfigBase<TSettings, TProvider, TName> {
  create?: never

  import: () => Promise<ProviderModule<TSettings>>

  creatorFunctionName: string
}

/**
 * Provider Extension 配置接口
 * 使用联合类型确保 create 和 import 互斥
 *
 * @typeParam TSettings - Provider 配置类型
 * @typeParam TProvider - 实际 provider 类型（用于 variants）
 * @typeParam TName - Provider 名称类型（用于字面量推导）
 */
export type ProviderExtensionConfig<
  TSettings = any,
  TProvider extends ProviderV3 = ProviderV3,
  TName extends string = string
> =
  | ProviderExtensionConfigWithCreate<TSettings, TProvider, TName>
  | ProviderExtensionConfigWithImport<TSettings, TProvider, TName>

/**
 * Provider Extension 类
 *
 * @typeParam TSettings - Provider 配置类型
 * @typeParam TProvider - 实际 provider 类型（用于 variants）
 * @typeParam TConfig - 配置对象类型（幻影类型参数，用于自动推导 Provider IDs）
 */
export class ProviderExtension<
  TSettings = any,
  TProvider extends ProviderV3 = ProviderV3,
  TConfig extends ProviderExtensionConfig<TSettings, TProvider, string> = ProviderExtensionConfig<
    TSettings,
    TProvider,
    string
  >
> {
  /** Provider 实例缓存 - 按 settings hash 存储，LRU 自动清理 */
  private instances: LRUCache<string, TProvider>

  /** In-flight promise map - 防止并发创建相同 settings 的 provider */
  private pendingCreations: Map<string, Promise<TProvider>> = new Map()

  constructor(public readonly config: TConfig) {
    if (!config.name) {
      throw new Error('ProviderExtension: name is required')
    }

    this.instances = new LRUCache<string, TProvider>({
      max: 10,
      updateAgeOnGet: true
    })
  }

  /**
   * 静态工厂方法 - 创建 Provider Extension
   */
  static create<
    const TConfig extends ProviderExtensionConfig<any, any, string>,
    TSettings = TConfig extends ProviderExtensionConfig<infer S, any, any> ? S : any,
    TProvider extends ProviderV3 = TConfig extends ProviderExtensionConfig<any, infer P, any> ? P : ProviderV3
  >(config: TConfig | (() => TConfig)): ProviderExtension<TSettings, TProvider, TConfig>
  static create(config: any): ProviderExtension<any, any, any> {
    const resolvedConfig = typeof config === 'function' ? config() : config
    return new ProviderExtension(resolvedConfig)
  }

  /**
   * Options getter - 只读配置
   */
  get options(): Readonly<Partial<TSettings>> {
    return Object.freeze({ ...this.config.defaultOptions })
  }

  /**
   * 计算 settings 的稳定 hash
   */
  private computeHash(settings?: TSettings, variantSuffix?: string): string {
    const baseKey = (() => {
      if (settings === undefined || settings === null) {
        return 'default'
      }

      const stableStringify = (obj: any): string => {
        if (obj === null || obj === undefined) return 'null'
        if (typeof obj === 'function') return '"[function]"'
        if (typeof obj !== 'object') return JSON.stringify(obj)
        if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`

        const keys = Object.keys(obj).sort()
        const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
        return `{${pairs.join(',')}}`
      }

      return stableStringify(settings)
    })()

    return variantSuffix ? `${baseKey}:${variantSuffix}` : baseKey
  }

  /**
   * 创建 Provider 实例
   * 相同 settings 会复用实例，不同 settings 会创建新实例
   */
  async createProvider(settings?: TSettings, variantSuffix?: string): Promise<TProvider> {
    if (variantSuffix) {
      const variant = this.getVariant(variantSuffix)
      if (!variant) {
        throw new Error(
          `ProviderExtension "${this.config.name}": variant "${variantSuffix}" not found. ` +
            `Available variants: ${this.config.variants?.map((v) => v.suffix).join(', ') || 'none'}`
        )
      }
    }

    const mergedSettings = deepMergeObjects(this.config.defaultOptions || {}, settings || {}) as TSettings

    const hash = this.computeHash(mergedSettings, variantSuffix)

    const cachedInstance = this.instances.get(hash)
    if (cachedInstance) {
      return cachedInstance
    }

    const pending = this.pendingCreations.get(hash)
    if (pending) {
      return pending
    }

    const creationPromise = this._doCreateProvider(mergedSettings, variantSuffix, hash)
    this.pendingCreations.set(hash, creationPromise)

    try {
      return await creationPromise
    } finally {
      this.pendingCreations.delete(hash)
    }
  }

  /**
   * 获取基础 provider 实例（无变体转换）
   * 用于访问 provider 的 .tools 属性
   */
  async getBaseProvider(settings?: TSettings): Promise<TProvider> {
    return this.createProvider(settings)
  }

  private async _doCreateProvider(
    mergedSettings: TSettings,
    variantSuffix: string | undefined,
    hash: string
  ): Promise<TProvider> {
    let baseProvider: ProviderV3

    if (this.config.create) {
      baseProvider = await Promise.resolve(this.config.create(mergedSettings))
    } else if (this.config.import && this.config.creatorFunctionName) {
      const module = await this.config.import()
      const creatorFn = module[this.config.creatorFunctionName]

      if (!creatorFn || typeof creatorFn !== 'function') {
        throw new Error(
          `ProviderExtension "${this.config.name}": creatorFunctionName "${this.config.creatorFunctionName}" not found in imported module`
        )
      }

      baseProvider = await Promise.resolve(creatorFn(mergedSettings))
    } else {
      throw new Error(`ProviderExtension "${this.config.name}": cannot create provider, invalid configuration`)
    }

    let finalProvider: TProvider
    if (variantSuffix) {
      const variant = this.getVariant(variantSuffix)!
      if (variant.transform) {
        const baseHash = this.computeHash(mergedSettings)
        if (!this.instances.has(baseHash)) {
          this.instances.set(baseHash, baseProvider as TProvider)
        }
        finalProvider = (await Promise.resolve(
          variant.transform(baseProvider as TProvider, mergedSettings)
        )) as TProvider
      } else {
        finalProvider = baseProvider as TProvider
      }
    } else {
      finalProvider = baseProvider as TProvider
    }

    this.instances.set(hash, finalProvider)

    return finalProvider
  }

  /**
   * 配置 provider（链式调用）
   * 返回一个新的 Extension 实例，不修改原实例
   */
  configure(settings: Partial<TSettings>): ProviderExtension<TSettings, TProvider> {
    return new ProviderExtension({
      ...this.config,
      defaultOptions: deepMergeObjects(this.config.defaultOptions || ({} as any), settings)
    })
  }

  /**
   * 获取所有 provider IDs（包含变体和别名）
   */
  getProviderIds(): string[] {
    const ids = [this.config.name, ...(this.config.aliases || [])]

    if (this.config.variants) {
      for (const variant of this.config.variants) {
        ids.push(`${this.config.name}-${variant.suffix}`)
      }
    }

    return ids
  }

  /**
   * 检查给定 ID 是否属于此 Extension
   */
  hasProviderId(id: string): boolean {
    return this.getProviderIds().includes(id)
  }

  /**
   * 获取变体配置
   */
  getVariant(suffix: string): ProviderVariant<TSettings, TProvider> | undefined {
    return this.config.variants?.find((v) => v.suffix === suffix)
  }

  /**
   * 清除所有缓存的 Provider 实例
   */
  clearCache(): void {
    this.instances.clear()
    this.pendingCreations.clear()
  }

  /**
   * 获取已缓存的 provider 实例（如果存在）
   */
  getCachedProvider(): TProvider | undefined {
    for (const [key, value] of this.instances.entries()) {
      if (!key.includes(':')) return value
    }
    for (const [, value] of this.instances.entries()) {
      return value
    }
    return undefined
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { cachedInstances: number } {
    return {
      cachedInstances: this.instances.size
    }
  }
}
