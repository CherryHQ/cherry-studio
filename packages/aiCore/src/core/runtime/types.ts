/**
 * Runtime 层类型定义
 */
import type { EmbeddingModelV3, ImageModelV3, ProviderV3, RerankingModelV3 } from '@ai-sdk/provider'
import type { JSONObject } from '@ai-sdk/provider'
import type { embedMany, Experimental_DownloadFunction, generateImage, generateText, rerank, streamText } from 'ai'

import { type AiPlugin } from '../plugins'
import type { CoreProviderSettingsMap, StringKeys } from '../providers/types'

/**
 * 运行时执行器配置
 *
 * @typeParam TSettingsMap - Provider Settings Map（默认 CoreProviderSettingsMap）
 * @typeParam T - Provider ID 类型（从 TSettingsMap 的键推断）
 */
export interface RuntimeConfig<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
> {
  providerId: T
  provider: ProviderV3
  providerSettings: TSettingsMap[T]
  plugins?: AiPlugin[]
  /**
   * 模型解析函数
   * 从 variant 的 resolveModel 声明中提取（类型安全在 extension 声明处保证）。
   * 不提供时使用 AI SDK 默认的 provider.languageModel()。
   */
  modelResolver?: (modelId: string) => any
}

export type generateImageParams = Omit<Parameters<typeof generateImage>[0], 'model'> & {
  model: string | ImageModelV3
  experimental_download?: Experimental_DownloadFunction
}
export type generateImageResult = Awaited<ReturnType<typeof generateImage>>
export type generateTextParams = Parameters<typeof generateText>[0]
export type streamTextParams = Parameters<typeof streamText>[0]

// Embedding types (AI SDK v6 only has embedMany, no embed)
export type EmbedManyParams = Omit<Parameters<typeof embedMany>[0], 'model'> & {
  model: string | EmbeddingModelV3
}
export type EmbedManyResult = Awaited<ReturnType<typeof embedMany>>

// Keep the model override so string ids can be resolved through RuntimeExecutor's provider registry.
export type RerankParams<VALUE extends JSONObject | string = string> = Omit<
  Parameters<typeof rerank<VALUE>>[0],
  'model'
> & {
  model: string | RerankingModelV3
}
export type RerankResult<VALUE extends JSONObject | string = string> = Awaited<ReturnType<typeof rerank<VALUE>>>
