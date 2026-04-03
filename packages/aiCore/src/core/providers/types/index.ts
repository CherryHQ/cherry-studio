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
import type { ToolFactoryMap } from './toolFactory'

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * 提取对象类型中的字符串键
 * @example StringKeys<{ foo: 1, 0: 2 }> = 'foo'
 */
export type StringKeys<T> = Extract<keyof T, string>

/** 从 coreExtensions 自动提取的 Provider ID literal union */
export type RegisteredProviderId = StringKeys<CoreProviderSettingsMap>

/** 允许已注册 ID（有自动补全）和任意字符串（动态 provider） */
export type ProviderId = RegisteredProviderId | (string & {})

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

/** Provider 变体配置 */
export interface ProviderVariant<TSettings = any, TProvider extends ProviderV3 = ProviderV3> {
  suffix: string
  name: string

  /** 类型安全的模型解析：provider.responses(modelId) / provider.chat(modelId) */
  resolveModel?: (provider: TProvider, modelId: string) => LanguageModel

  /** 替换整个 provider（如 azure-anthropic），简单方法切换用 resolveModel */
  transform?: (baseProvider: TProvider, settings?: TSettings) => ProviderV3

  toolFactories?: ToolFactoryMap<TProvider>
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
export type ExtractExtensionSettings<T> = T extends ProviderExtension<infer TSettings, any, any> ? TSettings : never

/**
 * Map all Provider IDs from an Extension to its Settings type
 */
export type ExtensionToSettingsMap<T> = T extends ProviderExtension<infer TSettings, any, infer TConfig>
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

export type { ToolCapability, ToolFactory, ToolFactoryMap, ToolFactoryPatch } from './toolFactory'

// ============================================================================
// Tool Config Type Extraction (from extension declarations via as const)
// ============================================================================

/** Extract a capability's config type from an extension's toolFactories */
export type ExtractToolConfig<TExt, K extends string> = TExt extends {
  config: { toolFactories?: { [P in K]?: (provider: any) => (config: infer C) => any } }
}
  ? C
  : never

/** Extract config from variant-level toolFactories (e.g., openai-chat) */
type ExtractVariantToolConfig<TExt, K extends string> = TExt extends {
  config: {
    name: infer TName extends string
    variants?: readonly (infer V)[]
  }
}
  ? V extends {
      suffix: infer TSuffix extends string
      toolFactories?: { [P in K]?: (provider: any) => (config: infer C) => any }
    }
    ? { id: `${TName}-${TSuffix}`; config: C }
    : never
  : never

/** Extract { [providerId]: ConfigType } map from all extensions for a capability */
export type ExtractToolConfigMap<TExtUnion, K extends string> = UnionToIntersection<
  | (TExtUnion extends any
      ? ExtractToolConfig<TExtUnion, K> extends never
        ? never
        : TExtUnion extends { config: { name: infer TName extends string } }
          ? { [P in TName]?: ExtractToolConfig<TExtUnion, K> }
          : never
      : never)
  // Variant configs: name-suffix → config
  | (TExtUnion extends any
      ? ExtractVariantToolConfig<TExtUnion, K> extends never
        ? never
        : ExtractVariantToolConfig<TExtUnion, K> extends { id: infer TId extends string; config: infer C }
          ? { [P in TId]?: C }
          : never
      : never)
>

/** Auto-extracted from coreExtensions' toolFactories.webSearch declarations */
export type WebSearchToolConfigMap = ExtractToolConfigMap<(typeof coreExtensions)[number], 'webSearch'>
