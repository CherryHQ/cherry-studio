import type { ProviderV2, ProviderV3 } from '@ai-sdk/provider'
import type {
  EmbeddingModel,
  EmbeddingModelUsage,
  ImageModel,
  ImageModelUsage,
  LanguageModel,
  LanguageModelUsage,
  SpeechModel,
  TranscriptionModel
} from 'ai'

import type { coreExtensions } from '../core/initialization'
import type { ProviderExtension } from '../core/ProviderExtension'

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * 提取对象类型中的字符串键
 * @example StringKeys<{ foo: 1, 0: 2 }> = 'foo'
 */
export type StringKeys<T> = Extract<keyof T, string>

/**
 * 已注册的 Provider ID
 * 从 coreExtensions 数组自动提取所有 Provider IDs
 * 类型安全的 literal union
 *
 * 如果需要支持动态/未注册的 provider，使用：
 * RegisteredProviderId | (string & {})
 */
export type RegisteredProviderId = keyof CoreProviderSettingsMap

// 错误类型
export class ProviderError extends Error {
  constructor(
    message: string,
    public providerId: string,
    public code?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export type AiSdkModel = LanguageModel | ImageModel | EmbeddingModel | TranscriptionModel | SpeechModel
export type AiSdkProvider = ProviderV2 | ProviderV3
export type AiSdkUsage = LanguageModelUsage | ImageModelUsage | EmbeddingModelUsage

export type AiSdkModelType = 'text' | 'image' | 'embedding' | 'transcription' | 'speech'

const METHOD_MAP = {
  text: 'languageModel',
  image: 'imageModel',
  embedding: 'embeddingModel',
  transcription: 'transcriptionModel',
  speech: 'speechModel'
} as const satisfies Record<AiSdkModelType, keyof ProviderV3>

type AiSdkModelReturnMap = {
  text: LanguageModel
  image: ImageModel
  embedding: EmbeddingModel
  transcription: TranscriptionModel
  speech: SpeechModel
}

export type AiSdkMethodName<T extends AiSdkModelType> = (typeof METHOD_MAP)[T]

export type AiSdkModelReturn<T extends AiSdkModelType> = AiSdkModelReturnMap[T]

// ============================================================================
// Provider Extension 类型定义
// ============================================================================

/**
 * Extension Storage - 运行时状态存储
 * 用于缓存 provider 实例和连接状态
 */
export interface ExtensionStorage {
  /** Provider 实例缓存 */
  providerCache?: Map<string, ProviderV3>

  /** 连接状态跟踪 */
  connectionState?: {
    isHealthy: boolean
    lastCallTime?: number
    errorCount?: number
    lastError?: Error
  }

  /** 自定义扩展存储 */
  [key: string]: any
}

/**
 * Storage 访问器 - 类型安全的 get/set
 */
export type StorageAccessor<T extends ExtensionStorage = ExtensionStorage> = {
  get<K extends keyof T>(key: K): T[K] | undefined
  set<K extends keyof T>(key: K, value: T[K]): void
  clear(): void
  has<K extends keyof T>(key: K): boolean
}

/**
 * Provider 变体配置
 * 用于支持同一 provider 的不同模式（如 Azure 的 chat 和 responses）
 *
 * @typeParam TSettings - Provider 配置类型
 * @typeParam TProvider - 实际 provider 类型（默认 ProviderV3）
 *
 * @example
 * ```typescript
 * import type { OpenAIProvider } from '@ai-sdk/openai'
 *
 * const chatVariant: ProviderVariant<OpenAIProviderSettings, OpenAIProvider> = {
 *   suffix: 'chat',
 *   name: 'OpenAI Chat',
 *   transform: (provider, settings) => customProvider({
 *     fallbackProvider: {
 *       ...provider,
 *       languageModel: (modelId) => provider.chat(modelId) // ✅ TypeScript 知道 provider 有 .chat()
 *     }
 *   })
 * }
 * ```
 */
export interface ProviderVariant<TSettings = any, TProvider extends ProviderV3 = ProviderV3> {
  /** 变体 ID 后缀，如 'chat', 'responses' */
  suffix: string

  /** 变体显示名称 */
  name: string

  /** 变体转换函数：将基础 provider 转换为变体 */
  transform: (baseProvider: TProvider, settings?: TSettings) => ProviderV3
}

/**
 * Extension Context - 钩子函数中的 this 类型
 * 提供类型安全的属性访问
 */
export interface ExtensionContext<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3
> {
  /** Extension 名称 */
  readonly name: string

  /** 当前合并后的配置 */
  readonly options: TSettings

  /** Storage 访问器 */
  readonly storage: StorageAccessor<TStorage>

  /** 获取变体配置 */
  getVariant(suffix: string): ProviderVariant<TSettings, TProvider> | undefined

  /** 检查 provider ID 是否属于此 extension */
  hasProviderId(id: string): boolean
}

/**
 * Extension Hook - 带绑定 context 的钩子函数
 */
export type ExtensionHook<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3,
  TReturn = void
> = (this: ExtensionContext<TSettings, TStorage, TProvider>, settings: TSettings) => TReturn | Promise<TReturn>

/**
 * 生命周期钩子配置
 */
export interface LifecycleHooks<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3
> {
  /**
   * 创建前钩子
   * 用途：网络检查、配置加载、验证
   * 可抛出错误来阻止创建
   */
  onBeforeCreate?: ExtensionHook<TSettings, TStorage, TProvider, void>

  /**
   * 创建后钩子
   * 用途：初始化、缓存、日志记录
   * @param provider - 创建的 provider 实例（类型为 TProvider）
   */
  onAfterCreate?: (
    this: ExtensionContext<TSettings, TStorage, TProvider>,
    settings: TSettings,
    provider: TProvider
  ) => void | Promise<void>
}

// ============================================================================
// Provider ID Type Extraction Utilities
// ============================================================================

/**
 * Extract all Provider IDs from an extension config
 * 保留字面量类型，避免被推断为 string
 */
export type ExtractProviderIds<TConfig> = TConfig extends { name: infer TName }
  ? TName extends string
    ?
        | TName
        | (TConfig extends { aliases: infer TAliases }
            ? TAliases extends readonly string[]
              ? TAliases[number]
              : never
            : never)
        | (TConfig extends { variants: infer TVariants }
            ? TVariants extends readonly any[]
              ? TVariants[number] extends { suffix: infer TSuffix }
                ? TSuffix extends string
                  ? `${TName}-${TSuffix}`
                  : never
                : never
              : never
            : never)
    : never
  : never

/**
 * Extract Provider IDs from a ProviderExtension instance
 */
export type ExtractExtensionIds<T> = T extends { config: infer TConfig } ? ExtractProviderIds<TConfig> : never

/**
 * Extract Settings type from a ProviderExtension instance
 *
 * @example
 * ```typescript
 * type Settings = ExtractExtensionSettings<typeof OpenAIExtension>
 * // => OpenAIProviderSettings
 * ```
 */
export type ExtractExtensionSettings<T> = T extends ProviderExtension<infer TSettings, any, any, any>
  ? TSettings
  : never

/**
 * Map all Provider IDs from an Extension to its Settings type
 */
export type ExtensionToSettingsMap<T> = T extends ProviderExtension<infer TSettings, any, any, infer TConfig>
  ? { [K in ExtractProviderIds<TConfig>]: TSettings }
  : never

// ============================================================================
// Provider Settings Map - Auto-extracted from Extensions
// ============================================================================

/**
 * Core Provider Settings Map
 */
export type CoreProviderSettingsMap = UnionToIntersection<ExtensionToSettingsMap<(typeof coreExtensions)[number]>>

// 辅助类型：提取所有变体 ID
type ExtractVariantIds<TConfig, TName extends string> = TConfig extends {
  variants: readonly { suffix: infer TSuffix extends string }[]
}
  ? `${TName}-${TSuffix}`
  : never

export type ExtensionConfigToIdResolutionMap<TConfig> = TConfig extends { name: infer TName extends string }
  ? {
      readonly [K in
        | TName
        | (TConfig extends { aliases: readonly (infer TAlias extends string)[] } ? TAlias : never)
        | ExtractVariantIds<TConfig, TName>]: K extends ExtractVariantIds<TConfig, TName>
        ? K // 变体 → 自身
        : TName // 基础名和别名 → TName
    }
  : never

/**
 * Provider IDs Map Type with Literal Type Inference
 */
export type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never
