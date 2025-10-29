import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { type OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { type SharedV2ProviderMetadata } from '@ai-sdk/provider'
import { type XaiProviderOptions } from '@ai-sdk/xai'
import { type OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'

export type ProviderOptions<T extends keyof SharedV2ProviderMetadata> = SharedV2ProviderMetadata[T]

/**
 * 供应商选项类型，如果map中没有，说明没有约束
 */
export type ProviderOptionsMap = {
  openai: OpenAIResponsesProviderOptions
  anthropic: AnthropicProviderOptions
  google: GoogleGenerativeAIProviderOptions
  openrouter: OpenRouterProviderOptions
  xai: XaiProviderOptions
}

// 工具类型，用于从ProviderOptionsMap中提取特定供应商的选项类型
export type ExtractProviderOptions<T extends keyof ProviderOptionsMap> = ProviderOptionsMap[T]

/**
 * 类型安全的ProviderOptions
 * 对于已知供应商使用严格类型，对于未知供应商允许任意Record<string, JSONValue>
 */
export type TypedProviderOptions = {
  [K in keyof ProviderOptionsMap]?: ProviderOptionsMap[K]
} & {
  [K in string]?: Record<string, any>
} & SharedV2ProviderMetadata
