import { type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import { type OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { type SharedV3ProviderOptions } from '@ai-sdk/provider'
import { type XaiProviderOptions } from '@ai-sdk/xai'
import { type OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'

/**
 * Known provider options map for type-safe providerOptions construction.
 * Other providers use the SDK's shared JSON options contract.
 */
type ProviderOptionsMap = {
  openai: OpenAIResponsesProviderOptions
  anthropic: AnthropicProviderOptions
  google: GoogleGenerativeAIProviderOptions
  openrouter: OpenRouterProviderOptions
  xai: XaiProviderOptions
}

/**
 * Type-safe ProviderOptions.
 * Known providers use their SDK types; other namespaces use shared provider options.
 */
export type TypedProviderOptions = {
  [K in keyof ProviderOptionsMap]?: ProviderOptionsMap[K]
} & SharedV3ProviderOptions
