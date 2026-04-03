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

export type { AppProviderId, AppProviderSettingsMap, AppRuntimeConfig } from './merged'
export { appProviderIds, getAllProviderIds, isRegisteredProviderId } from './merged'

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
