/**
 * This type definition file is only for renderer.
 * It cannot be migrated to @renderer/types since files within it are actually being used by both main and renderer.
 * If we do that, main would throw an error because it cannot import a module which imports a type from a browser-enviroment-only package.
 * (ai-core package is set as browser-enviroment-only)
 *
 * TODO: We should separate them clearly. Keep renderer only types in renderer, and main only types in main, and shared types in shared.
 */

import type { AppProviderId, AppProviderSettingsMap } from './merged'

/**
 * Generic AI SDK configuration with compile-time type safety
 *
 * 🎯 Zero maintenance! Auto-extracts types from core and project extensions.
 *
 * @typeParam T - The specific provider ID type for type-safe options
 *
 * @example
 * ```ts
 * // Type-safe config for core provider
 * const config1: AiSdkConfig<'openai'> = {
 *   providerId: 'openai',
 *   options: { apiKey: '...', baseURL: '...' } // ✅ Typed as OpenAIProviderSettings
 * }
 *
 * // Type-safe config for project provider
 * const config2: AiSdkConfig<'google-vertex'> = {
 *   providerId: 'google-vertex',
 *   options: { ... } // ✅ Typed as GoogleVertexProviderSettings
 * }
 *
 * // Type-safe config with alias
 * const config3: AiSdkConfig<'oai'> = {
 *   providerId: 'oai',
 *   options: { apiKey: '...' } // ✅ Same type as 'openai'
 * }
 * ```
 */
export type AiSdkConfig<T extends AppProviderId = AppProviderId> = {
  providerId: T
  options: AppProviderSettingsMap[T]
}

/**
 * Runtime-safe AI SDK configuration for gradual migration
 * Use this when provider ID is not known at compile time
 *
 * 使用联合类型而不是 any，提供更好的类型安全性
 *
 * @example
 * ```ts
 * function createConfig(providerId: AppProviderId): AiSdkConfigRuntime {
 *   return {
 *     providerId,
 *     options: buildOptions(providerId) // ✅ 类型安全：options 必须是某个 provider 的 settings
 *   }
 * }
 * ```
 */
export type AiSdkConfigRuntime = {
  providerId: AppProviderId
  options: AppProviderSettingsMap[AppProviderId]
}

/**
 * Type guard for runtime validation of AiSdkConfig
 *
 * @param config - Unknown value to validate
 * @returns true if config is a valid AiSdkConfigRuntime
 *
 * @example
 * ```ts
 * if (isValidAiSdkConfig(someConfig)) {
 *   // someConfig is now typed as AiSdkConfigRuntime
 *   await createAiSdkProvider(someConfig)
 * }
 * ```
 */
export function isValidAiSdkConfig(config: unknown): config is AiSdkConfigRuntime {
  if (!config || typeof config !== 'object') return false

  const c = config as Record<string, unknown>

  return (
    typeof c.providerId === 'string' && c.providerId.length > 0 && typeof c.options === 'object' && c.options !== null
  )
}

export type { AppProviderId, AppProviderSettingsMap } from './merged'
export { appProviderIds, getAllProviderIds, isRegisteredProviderId } from './merged'
