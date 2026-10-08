/**
 * Runtime 层类型定义
 */
import type { ImageModelV3, ImageModelV4, EmbeddingModelV3, EmbeddingModelV4 } from '@ai-sdk/provider'
import type { JSONObject } from '@ai-sdk/provider'
import type { embedMany, Experimental_DownloadFunction, generateImage, generateText, rerank, streamText } from 'ai'

import { type AiPlugin } from '../plugins'
import type { AiSdkProvider, CoreProviderSettingsMap, StringKeys } from '../providers/types'

export type RuntimeProviderCallEvent =
  | {
      modality: 'embedding'
      requestId: string
      providerId: string
      modelId: string
      usage?: { tokens: number }
      metrics: { timeCompletionMs: number }
      completedAt: number
    }
  | {
      modality: 'image'
      requestId: string
      providerId: string
      modelId: string
      imageCount: number
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
      metrics: { timeCompletionMs: number }
      completedAt: number
    }
  | {
      modality: 'rerank'
      requestId: string
      providerId: string
      modelId: string
      metrics: { timeCompletionMs: number }
      completedAt: number
    }

export type RuntimeProviderCallHandler = (event: RuntimeProviderCallEvent) => void

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
  provider: AiSdkProvider
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
  model: string | ImageModelV3 | ImageModelV4
  experimental_download?: Experimental_DownloadFunction
  onProviderCall?: RuntimeProviderCallHandler
}
export type generateImageResult = Awaited<ReturnType<typeof generateImage>>
export type generateTextParams = Parameters<typeof generateText>[0]
export type streamTextParams = Parameters<typeof streamText>[0]

// Batch embedding with per-call usage observation.
export type EmbedManyParams = Omit<Parameters<typeof embedMany>[0], 'model'> & {
  model: string | EmbeddingModelV3 | EmbeddingModelV4
  onProviderCall?: RuntimeProviderCallHandler
}
export type EmbedManyResult = Awaited<ReturnType<typeof embedMany>>

// Keep the model override so string ids can be resolved through RuntimeExecutor's provider registry.
export type RerankParams<VALUE extends JSONObject | string = string> = Omit<
  Parameters<typeof rerank<VALUE>>[0],
  'model'
> & {
  model: Parameters<typeof rerank>[0]['model']
  onProviderCall?: RuntimeProviderCallHandler
}
export type RerankResult<VALUE extends JSONObject | string = string> = Awaited<ReturnType<typeof rerank<VALUE>>>
