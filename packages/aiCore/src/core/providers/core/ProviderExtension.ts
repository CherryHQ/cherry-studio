import type { ProviderV3 } from '@ai-sdk/provider'

import { deepMergeObjects } from '../../utils'
import type { ExtensionContext, ExtensionStorage, LifecycleHooks, ProviderVariant, StorageAccessor } from '../types'

/**
 * 全局 Provider 存储
 * Extension 创建的 provider 实例注册到这里，供 HubProvider 等使用
 * Key: explicit ID (用户指定的唯一标识)
 * Value: Provider 实例
 */
export const globalProviderStorage = new Map<string, ProviderV3>()

/**
 * Provider 创建函数类型
 */
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
 * Provider Extension 配置接口
 *
 * @typeParam TSettings - Provider 配置类型
 * @typeParam TStorage - Extension storage 类型
 * @typeParam TProvider - 实际 provider 类型（用于 variants）
 */
export interface ProviderExtensionConfig<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3,
  TName extends string = string
> {
  /** Provider 唯一标识 */
  name: TName

  /** 别名列表（可选） */
  aliases?: readonly string[]

  /** 默认配置选项 */
  defaultOptions?: Partial<TSettings>

  /** 初始 storage 状态 */
  initialStorage?: Partial<TStorage>

  /** 是否支持图像生成 */
  supportsImageGeneration?: boolean

  /**
   * 创建 provider 实例的函数
   * 与 import 二选一，优先使用 create
   */
  create?: ProviderCreatorFunction<TSettings>

  /**
   * 动态导入模块的函数
   * 用于延迟加载第三方 provider
   */
  import?: () => Promise<ProviderModule<TSettings>>

  /**
   * 导入模块后的 creator 函数名
   * 配合 import 使用
   */
  creatorFunctionName?: string

  /**
   * 生命周期钩子
   */
  hooks?: LifecycleHooks<TSettings, TStorage, TProvider>

  /**
   * Provider 变体配置
   * 用于注册同一 provider 的不同模式
   *
   * 使用 TProvider 泛型参数指定实际的 provider 类型，
   * 这样 transform 函数就能正确识别 provider 的方法
   */
  variants?: readonly ProviderVariant<TSettings, TProvider>[]
}

/**
 * Provider Extension 类
 *
 * @typeParam TSettings - Provider 配置类型
 * @typeParam TStorage - Extension storage 类型
 * @typeParam TProvider - 实际 provider 类型（用于 variants）
 * @typeParam TConfig - 配置对象类型（幻影类型参数，用于自动推导 Provider IDs）
 *
 * @example
 * ```typescript
 * const OpenAIExtension = new ProviderExtension<OpenAIProviderSettings>({
 *   name: 'openai',
 *   create: (settings) => createOpenAI(settings),
 *   hooks: {
 *     onBeforeCreate(settings) {
 *       // this 是类型安全的 ExtensionContext
 *       if (!settings.apiKey) {
 *         throw new Error('API key required')
 *       }
 *     },
 *     onAfterCreate(settings, provider) {
 *       // 缓存 provider 实例
 *       this.storage.set('providerCache', new Map([[settings.apiKey, provider]]))
 *     }
 *   },
 *   variants: [
 *     {
 *       suffix: 'chat',
 *       name: 'OpenAI Chat',
 *       transform: (baseProvider) => customProvider({
 *         fallbackProvider: {
 *           ...baseProvider,
 *           languageModel: (modelId) => baseProvider.chat(modelId)
 *         }
 *       })
 *     }
 *   ]
 * })
 * ```
 */
export class ProviderExtension<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3,
  TConfig extends ProviderExtensionConfig<TSettings, TStorage, TProvider, string> = ProviderExtensionConfig<
    TSettings,
    TStorage,
    TProvider,
    string
  >
> {
  private _storage: Map<string, any>

  /** Provider 实例缓存 - 按 settings hash 存储 */
  private instances: Map<string, TProvider> = new Map()

  /** Settings hash 映射表 - 用于验证缓存是否仍然有效 */
  private settingsHashes: Map<string, TSettings | undefined> = new Map()

  constructor(public readonly config: TConfig) {
    // 验证配置
    if (!config.name) {
      throw new Error('ProviderExtension: name is required')
    }

    if (!config.create && !config.import) {
      throw new Error(`ProviderExtension "${config.name}": either create or import must be provided`)
    }

    if (config.import && !config.creatorFunctionName) {
      throw new Error(`ProviderExtension "${config.name}": creatorFunctionName is required when using import`)
    }

    // 初始化 storage
    this._storage = new Map(Object.entries(config.initialStorage || {}))
  }

  /**
   * 静态工厂方法 - 创建 Provider Extension
   * 支持配置对象或函数形式（用于延迟配置）
   *
   * @typeParam TConfig - 配置对象类型，使用 const 修饰符保留字面量类型
   *
   * @param config - Extension 配置对象或返回配置的函数
   * @returns ProviderExtension 实例
   *
   * @example
   * ```typescript
   * // 方式 1: 直接传配置对象（推荐加 as const）
   * const OpenAIExt = ProviderExtension.create({
   *   name: 'openai',
   *   aliases: ['oai'],
   *   create: createOpenAI,
   *   hooks: {
   *     onBeforeCreate(settings) {
   *       if (!settings.apiKey) throw new Error('API key required')
   *     }
   *   }
   * } as const)  // ← as const 保留字面量类型，用于自动推导 Provider IDs
   *
   * // 方式 2: 传函数（延迟配置，允许访问外部变量）
   * const OpenAIExt = ProviderExtension.create(() => ({
   *   name: 'openai',
   *   create: createOpenAI,
   *   defaultOptions: {
   *     apiKey: process.env.OPENAI_API_KEY
   *   }
   * } as const))
   * ```
   */
  static create<
    const TConfig extends ProviderExtensionConfig<any, any, any, string>,
    TSettings = TConfig extends ProviderExtensionConfig<infer S, any, any, any> ? S : any,
    TStorage extends ExtensionStorage = TConfig extends ProviderExtensionConfig<any, infer St, any, any>
      ? St
      : ExtensionStorage,
    TProvider extends ProviderV3 = TConfig extends ProviderExtensionConfig<any, any, infer P, any> ? P : ProviderV3
  >(config: TConfig | (() => TConfig)): ProviderExtension<TSettings, TStorage, TProvider, TConfig>
  static create(config: any): ProviderExtension<any, any, any, any> {
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
   * Storage accessor - 类型安全的访问器
   */
  get storage(): StorageAccessor<TStorage> {
    return {
      get: <K extends keyof TStorage>(key: K): TStorage[K] | undefined => {
        return this._storage.get(key as string) as TStorage[K] | undefined
      },

      set: <K extends keyof TStorage>(key: K, value: TStorage[K]): void => {
        this._storage.set(key as string, value)
      },

      clear: (): void => {
        this._storage.clear()
        if (this.config.initialStorage) {
          Object.entries(this.config.initialStorage).forEach(([key, value]) => {
            this._storage.set(key, value)
          })
        }
      },

      has: <K extends keyof TStorage>(key: K): boolean => {
        return this._storage.has(key as string)
      }
    }
  }

  /**
   * 创建 extension context - 用于钩子的 this 绑定
   */
  private createContext(mergedSettings: TSettings): ExtensionContext<TSettings, TStorage, TProvider> {
    return {
      name: this.config.name,
      options: mergedSettings,
      storage: this.storage,
      getVariant: this.getVariant.bind(this),
      hasProviderId: this.hasProviderId.bind(this)
    }
  }

  /**
   * 执行生命周期钩子 - 正确绑定 this
   */
  async executeHook(
    hookName: 'onBeforeCreate' | 'onAfterCreate',
    settings: TSettings,
    provider?: TProvider
  ): Promise<void> {
    const hooks = this.config.hooks
    if (!hooks) return

    // eslint-disable-next-line @eslint-react/naming-convention/context-name
    const context = this.createContext(settings)

    if (hookName === 'onBeforeCreate' && hooks.onBeforeCreate) {
      await hooks.onBeforeCreate.call(context, settings)
    } else if (hookName === 'onAfterCreate' && hooks.onAfterCreate && provider) {
      await hooks.onAfterCreate.call(context, settings, provider)
    }
  }

  /**
   * 计算 settings 的稳定 hash
   * 用于缓存 key，确保相同配置复用实例
   *
   * @param settings - Provider 配置
   * @param variantSuffix - 可选的变体后缀，用于区分不同变体的缓存
   */
  private computeHash(settings?: TSettings, variantSuffix?: string): string {
    const baseHash = (() => {
      if (settings === undefined || settings === null) {
        return 'default'
      }

      // 使用 JSON.stringify 进行稳定序列化
      // 对于对象按键排序以确保一致性
      const stableStringify = (obj: any): string => {
        if (obj === null || obj === undefined) return 'null'
        if (typeof obj !== 'object') return JSON.stringify(obj)
        if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`

        const keys = Object.keys(obj).sort()
        const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
        return `{${pairs.join(',')}}`
      }

      const serialized = stableStringify(settings)

      // 使用简单的哈希函数（不需要加密级别的安全性）
      let hash = 0
      for (let i = 0; i < serialized.length; i++) {
        const char = serialized.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash // Convert to 32bit integer
      }

      return `${Math.abs(hash).toString(36)}`
    })()

    // 如果有变体后缀，将其附加到 hash 中
    return variantSuffix ? `${baseHash}:${variantSuffix}` : baseHash
  }

  /**
   * 注册 Provider 到全局注册表
   * Extension 拥有的 provider 实例会被注册到全局 Map，供 HubProvider 等使用
   * @private
   */
  private registerToAiSdk(provider: TProvider, explicitId: string): void {
    // 注册到全局 provider storage
    // 使用 explicit ID 作为 key
    globalProviderStorage.set(explicitId, provider as any)
  }

  /**
   * 创建 Provider 实例（带缓存）
   * 相同 settings 会复用实例，不同 settings 会创建新实例
   *
   * @param settings - Provider 配置
   * @param explicitId - 可选的显式 ID，用于 AI SDK 注册
   * @param variantSuffix - 可选的变体后缀，用于应用变体转换
   * @returns Provider 实例
   */
  async createProvider(settings?: TSettings, explicitId?: string, variantSuffix?: string): Promise<TProvider> {
    // 验证变体后缀（如果提供）
    if (variantSuffix) {
      const variant = this.getVariant(variantSuffix)
      if (!variant) {
        throw new Error(
          `ProviderExtension "${this.config.name}": variant "${variantSuffix}" not found. ` +
            `Available variants: ${this.config.variants?.map((v) => v.suffix).join(', ') || 'none'}`
        )
      }
    }

    // 合并 default options
    const mergedSettings = deepMergeObjects(
      (this.config.defaultOptions || {}) as any,
      (settings || {}) as any
    ) as TSettings

    // 计算 hash（包含变体后缀）
    const hash = this.computeHash(mergedSettings, variantSuffix)

    // 检查缓存
    const cachedInstance = this.instances.get(hash)
    if (cachedInstance) {
      return cachedInstance
    }

    // 执行 onBeforeCreate 钩子
    await this.executeHook('onBeforeCreate', mergedSettings)

    // 创建基础 provider 实例
    let baseProvider: ProviderV3

    if (this.config.create) {
      // 使用直接创建函数
      baseProvider = await Promise.resolve(this.config.create(mergedSettings))
    } else if (this.config.import && this.config.creatorFunctionName) {
      // 动态导入
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

    // 应用变体转换（如果提供了变体后缀）
    let finalProvider: TProvider
    if (variantSuffix) {
      const variant = this.getVariant(variantSuffix)!
      // 应用变体的 transform 函数
      finalProvider = (await Promise.resolve(variant.transform(baseProvider as TProvider, mergedSettings))) as TProvider
    } else {
      finalProvider = baseProvider as TProvider
    }

    // 执行 onAfterCreate 钩子
    await this.executeHook('onAfterCreate', mergedSettings, finalProvider)

    // 缓存实例
    this.instances.set(hash, finalProvider)
    this.settingsHashes.set(hash, mergedSettings)

    // 确定注册 ID
    const registrationId = (() => {
      if (explicitId) {
        return explicitId
      }
      // 如果是变体，使用 name-suffix:hash 格式
      if (variantSuffix) {
        return `${this.config.name}-${variantSuffix}:${hash}`
      }
      // 否则使用 name:hash
      return `${this.config.name}:${hash}`
    })()

    // 注册到 AI SDK
    this.registerToAiSdk(finalProvider, registrationId)

    return finalProvider
  }

  /**
   * 配置 provider（链式调用）
   * 返回一个新的 Extension 实例，不修改原实例
   * 使用深度合并
   *
   * @example
   * ```typescript
   * const configured = OpenAIExtension.configure({
   *   apiKey: 'sk-xxx',
   *   baseURL: 'https://api.openai.com'
   * })
   * ```
   */
  configure(settings: Partial<TSettings>): ProviderExtension<TSettings, TStorage, TProvider> {
    return new ProviderExtension({
      ...this.config,
      defaultOptions: deepMergeObjects(this.config.defaultOptions || ({} as any), settings)
    })
  }

  /**
   * 获取所有 provider IDs（包含变体和别名）
   *
   * @returns 包含主 ID、别名和变体 ID 的数组
   *
   * @example
   * ```typescript
   * OpenAIExtension.getProviderIds()
   * // => ['openai', 'openai-chat']
   *
   * AzureExtension.getProviderIds()
   * // => ['azure', 'azure-chat', 'azure-responses']
   * ```
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
   * 调用后，下次 createProvider() 会重新创建实例
   */
  clearCache(): void {
    this.instances.clear()
    this.settingsHashes.clear()
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

/**
 * Provider Extension 构建器
 * 提供更友好的 API 来创建 Extension
 */
export class ProviderExtensionBuilder<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3
> {
  private config: Partial<ProviderExtensionConfig<TSettings, TStorage, TProvider>> = {}

  setName(name: string): this {
    this.config.name = name
    return this
  }

  setAliases(aliases: string[]): this {
    this.config.aliases = aliases
    return this
  }

  setDefaultOptions(options: Partial<TSettings>): this {
    this.config.defaultOptions = options
    return this
  }

  setInitialStorage(storage: Partial<TStorage>): this {
    this.config.initialStorage = storage
    return this
  }

  setSupportsImageGeneration(supports: boolean): this {
    this.config.supportsImageGeneration = supports
    return this
  }

  setCreate(create: ProviderCreatorFunction<TSettings>): this {
    this.config.create = create
    return this
  }

  setImport(importFn: () => Promise<ProviderModule<TSettings>>, creatorFunctionName: string): this {
    this.config.import = importFn
    this.config.creatorFunctionName = creatorFunctionName
    return this
  }

  setHooks(hooks: LifecycleHooks<TSettings, TStorage, TProvider>): this {
    this.config.hooks = hooks
    return this
  }

  addVariant(variant: ProviderVariant<TSettings, TProvider>): this {
    const variants = this.config.variants ? [...this.config.variants] : []
    variants.push(variant)
    this.config.variants = variants
    return this
  }

  build(): ProviderExtension<TSettings, TStorage, TProvider> {
    return new ProviderExtension(this.config as ProviderExtensionConfig<TSettings, TStorage, TProvider>)
  }
}

/**
 * 便捷函数：创建 Provider Extension
 * 使用 const type parameter 保留配置的字面量类型，用于类型推断
 */
export function createProviderExtension<
  const TConfig extends ProviderExtensionConfig<any, any, any, string>,
  TSettings = TConfig extends ProviderExtensionConfig<infer S, any, any, any> ? S : any,
  TStorage extends ExtensionStorage = TConfig extends ProviderExtensionConfig<any, infer St, any, any>
    ? St
    : ExtensionStorage,
  TProvider extends ProviderV3 = TConfig extends ProviderExtensionConfig<any, any, infer P, any> ? P : ProviderV3
>(config: TConfig): ProviderExtension<TSettings, TStorage, TProvider, TConfig> {
  return new ProviderExtension(config)
}
