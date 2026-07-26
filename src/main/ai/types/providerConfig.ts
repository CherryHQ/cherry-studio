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

/** The `providerOptions` namespace an AI SDK model reads — a different key space from
 *  the provider id. Produced only by `resolveProviderOptionsKey`. */
export type ProviderOptionsKey = string & { readonly __providerOptionsKey: unique symbol }

/** `Provider.id` — the user-editable instance name. */
export type ConcreteProviderId = string & { readonly __concreteProviderId: unique symbol }

/** The preset a provider derives from, else its own id — stable across a rename.
 *  Vendor-keyed behaviour (the transport registry) uses this, not the concrete id. */
export type PresetProviderId = string & { readonly __presetProviderId: unique symbol }

/** Only ever apply to a real `Provider.id`. */
export function asConcreteProviderId(providerId: string): ConcreteProviderId {
  return providerId as ConcreteProviderId
}

/** `provider.presetProviderId ?? provider.id` — the vendor identity. See above. */
export function asPresetProviderId(provider: { id: string; presetProviderId?: string }): PresetProviderId {
  return (provider.presetProviderId ?? provider.id) as PresetProviderId
}

/** A `ProviderConfig` with the three resolved identities attached — computed once by
 *  `providerToAiSdkConfig` so consumers never re-derive them. */
export type ResolvedProviderConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> =
  ProviderConfig<T> & {
    concreteProviderId: ConcreteProviderId
    presetProviderId: PresetProviderId
    optionsKey: ProviderOptionsKey
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
