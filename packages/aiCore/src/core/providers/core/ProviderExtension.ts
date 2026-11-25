import type { ProviderV3, RerankingModelV3 } from '@ai-sdk/provider'
import QuickLRU from 'quick-lru'

import { deepMergeObjects } from '../../utils'
import type { ProviderVariant, ToolFactoryMap } from '../types'

export type ProviderCreatorFunction<TSettings = any, TProvider extends ProviderV3 = ProviderV3> = (
  settings?: TSettings
) => TProvider | Promise<TProvider>

interface ProviderCreation<TProvider extends ProviderV3> {
  baseProvider: TProvider
  provider: ProviderV3
}

/**
 * Imported module namespace; the configured creator export is checked at runtime.
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Dynamic modules also export unrelated helpers and constants; check the selected creator before calling it.
export type ProviderModule = Record<string, unknown>

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
  variants?: readonly ProviderVariant<TSettings, TProvider, any>[]

  /**
   * Tool factory 映射
   * 声明该 provider 支持的工具能力（如 webSearch）
   * 工具工厂从 provider 实例的 .tools 属性提取
   */
  toolFactories?: ToolFactoryMap<TProvider>

  /** Creates provider.rerankingModel when the SDK provider does not expose it natively. */
  createRerankingModel?: (modelId: string, settings: TSettings) => RerankingModelV3
}

/**
 * Provider Extension 配置接口 - 使用 create 函数
 */
interface ProviderExtensionConfigWithCreate<
  TSettings = any,
  TProvider extends ProviderV3 = ProviderV3,
  TName extends string = string
> extends ProviderExtensionConfigBase<TSettings, TProvider, TName> {
  create: ProviderCreatorFunction<TSettings, TProvider>

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

  import: () => Promise<ProviderModule>

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
  private instances: QuickLRU<string, ProviderCreation<TProvider>>

  /** In-flight promise map - 防止并发创建相同 settings 的 provider */
  private pendingCreations: Map<string, Promise<ProviderCreation<TProvider>>> = new Map()

  /** Function identity is behaviorally significant for request-scoped fetch wrappers. */
  private functionIds = new WeakMap<object, number>()

  private nextFunctionId = 0

  constructor(public readonly config: TConfig) {
    if (!config.name) {
      throw new Error('ProviderExtension: name is required')
    }

    this.instances = new QuickLRU<string, ProviderCreation<TProvider>>({
      maxSize: 10
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

      const seen = new WeakSet()

      const stableStringify = (obj: any): string => {
        if (obj === null || obj === undefined) return 'null'

        if (typeof obj === 'function') {
          let id = this.functionIds.get(obj)

          if (id === undefined) {
            id = this.nextFunctionId++
            this.functionIds.set(obj, id)
          }

          return `[function:${id}]`
        }

        if (typeof obj !== 'object') return JSON.stringify(obj)

        if (seen.has(obj)) return '"[circular]"'
        seen.add(obj)

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
  createProvider(settings?: TSettings): Promise<TProvider>
  createProvider(settings: TSettings | undefined, variantSuffix: undefined): Promise<TProvider>
  createProvider(settings: TSettings | undefined, variantSuffix: string | undefined): Promise<ProviderV3>
  async createProvider(settings?: TSettings, variantSuffix?: string): Promise<ProviderV3> {
    const creation = await this.getOrCreateProvider(settings, variantSuffix)

    return variantSuffix ? creation.provider : creation.baseProvider
  }

  private async getOrCreateProvider(
    settings?: TSettings,
    variantSuffix?: string
  ): Promise<ProviderCreation<TProvider>> {
    if (variantSuffix) {
      const variant = this.getVariant(variantSuffix)

      if (!variant) {
        throw new Error(
          `ProviderExtension "${this.config.name}": variant "${variantSuffix}" not found. ` +
            `Available variants: ${this.config.variants?.map((v) => v.suffix).join(', ') || 'none'}`
        )
      }
    }

    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- The optional-settings API delegates missing required configuration to the SDK creator; partial defaults and input do not prove completeness.
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
  ): Promise<ProviderCreation<TProvider>> {
    let baseProvider: TProvider

    if (this.config.create) {
      baseProvider = await Promise.resolve(this.config.create(mergedSettings))
    } else if (this.config.import && this.config.creatorFunctionName) {
      const module = await this.config.import()

      const creatorFn = Object.hasOwn(module, this.config.creatorFunctionName)
        ? module[this.config.creatorFunctionName]
        : undefined

      if (!creatorFn || typeof creatorFn !== 'function') {
        throw new Error(
          `ProviderExtension "${this.config.name}": creatorFunctionName "${this.config.creatorFunctionName}" not found in imported module`
        )
      }

      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Legacy dynamic imports trust the registered creator contract; the callable check does not verify settings or the provider subtype.
      const createProvider = creatorFn as ProviderCreatorFunction<TSettings, TProvider>
      baseProvider = await Promise.resolve(createProvider(mergedSettings))
    } else {
      throw new Error(`ProviderExtension "${this.config.name}": cannot create provider, invalid configuration`)
    }

    this.attachRerankingModel(baseProvider, mergedSettings)

    let finalProvider: ProviderV3

    if (variantSuffix) {
      const variant = this.getVariant(variantSuffix)!

      if (variant.transform) {
        const baseHash = this.computeHash(mergedSettings)

        if (!this.instances.has(baseHash)) {
          this.instances.set(baseHash, { baseProvider, provider: baseProvider })
        }

        finalProvider = await Promise.resolve(variant.transform(baseProvider, mergedSettings))
      } else {
        finalProvider = baseProvider
      }
    } else {
      finalProvider = baseProvider
    }

    // Variant transforms can return a new provider object, so attach to the final instance too.
    this.attachRerankingModel(finalProvider, mergedSettings)
    const creation = { baseProvider, provider: finalProvider }
    this.instances.set(hash, creation)

    return creation
  }

  private attachRerankingModel(provider: ProviderV3, settings: TSettings): void {
    const { createRerankingModel } = this.config

    if (!createRerankingModel || provider.rerankingModel) {
      return
    }

    provider.rerankingModel = (modelId: string) => createRerankingModel(modelId, settings)
  }

  /**
   * 配置 provider（链式调用）
   * 返回一个新的 Extension 实例，不修改原实例
   */
  configure(settings: Partial<TSettings>): ProviderExtension<TSettings, TProvider> {
    return new ProviderExtension({
      ...this.config,
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Preserve the existing unvalidated partial-settings merge; only the SDK creator can accept or reject the resulting configuration.
      defaultOptions: deepMergeObjects(this.config.defaultOptions || {}, settings) as Partial<TSettings>
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
  getVariant(suffix: string): NonNullable<TConfig['variants']>[number] | undefined {
    // Typed-array membership supplies the element contract; this predicate only selects by suffix.
    return this.config.variants?.find(
      (variant): variant is NonNullable<TConfig['variants']>[number] => variant.suffix === suffix
    )
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
  getCachedProvider(): ProviderV3 | undefined {
    for (const [key, value] of this.instances) {
      if (!key.includes(':')) return value.provider
    }

    for (const [, value] of this.instances) {
      return value.provider
    }

    return undefined
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return {
      cachedInstances: this.instances.size
    }
  }
}
