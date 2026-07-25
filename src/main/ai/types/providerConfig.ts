import type { StringKeys } from '@cherrystudio/ai-core/provider'

import type { AppProviderSettingsMap, AppRuntimeConfig } from './merged'

/**
 * Provider 配置
 * 基于 RuntimeConfig，用于构建 provider 实例的基础配置
 */
export type ProviderConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> = Omit<
  AppRuntimeConfig<T>,
  'plugins' | 'provider'
> & {
  /**
   * API endpoint path extracted from baseURL
   * Used for identifying image generation endpoints and other special cases
   * @example 'chat/completions', 'images/generations', 'predict'
   */
  endpoint?: string
}

/**
 * A `ProviderConfig` with the provider's resolved identity attached — computed
 * once by `providerToAiSdkConfig` so consumers never re-derive it:
 * - `concreteProviderId`: the app-level provider id (`Provider.id`)
 * - `presetProviderId`: the preset this provider derives from, or its own id when
 *   it is not preset-derived. A user can duplicate or rename a built-in provider,
 *   which changes `Provider.id` but not what the provider *is* — so behaviour keyed
 *   on "which vendor is this" (the image transport registry) must key on this, while
 *   behaviour keyed on "what did we name this instance" (`optionsKey`, since
 *   `providerSettings.name` is the concrete id) must not.
 * - `optionsKey`: the `providerOptions` namespace the AI SDK model actually
 *   reads (see `resolveProviderOptionsKey`); differs from `providerId` for the
 *   vertex family (`'vertex'`) and the `openai-compatible` family (the concrete
 *   provider id, via `providerSettings.name`).
 */
export type ResolvedProviderConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> =
  ProviderConfig<T> & {
    concreteProviderId: string
    presetProviderId: string
    optionsKey: string
  }

/**
 * Model capability flags computed from model properties and assistant settings.
 * Used by provider-specific option builders to decide which parameters to include.
 */
export interface ProviderCapabilities {
  /** Whether reasoning/thinking parameters should be sent to the provider. */
  enableReasoning: boolean
  /** Whether provider-native web search should be enabled. */
  enableWebSearch: boolean
  /** Whether the model should generate images inline. */
  enableGenerateImage: boolean
  /** Whether provider-native URL context should be enabled. */
  enableUrlContext: boolean
}

/**
 * Result of completions operation
 */
export type CompletionsResult = {
  getText: () => string
  usage?: any
}
