/**
 * This type definition file is only for renderer.
 * It cannot be migrated to @renderer/types since files within it are actually being used by both main and renderer.
 * If we do that, main would throw an error because it cannot import a module which imports a type from a browser-enviroment-only package.
 * (ai-core package is set as browser-enviroment-only)
 *
 * TODO: We should separate them clearly. Keep renderer only types in renderer, and main only types in main, and shared types in shared.
 */

import type { AppProviderId, AppRuntimeConfig } from './merged'

/**
 * Provider 配置（不含 plugins）
 * 基于 RuntimeConfig，用于构建 provider 实例的基础配置
 *
 * 🎯 Zero maintenance! Auto-extracts types from core and project extensions.
 *
 * @typeParam T - The specific provider ID type for type-safe settings
 *
 * @example
 * ```ts
 * // Type-safe config for core provider
 * const config1: ProviderConfig<'openai'> = {
 *   providerId: 'openai',
 *   providerSettings: { apiKey: '...', baseURL: '...' } // ✅ Typed as OpenAIProviderSettings
 * }
 *
 * // Type-safe config for project provider
 * const config2: ProviderConfig<'google-vertex'> = {
 *   providerId: 'google-vertex',
 *   providerSettings: { ... } // ✅ Typed as GoogleVertexProviderSettings
 * }
 *
 * // Type-safe config with alias
 * const config3: ProviderConfig<'oai'> = {
 *   providerId: 'oai',
 *   providerSettings: { apiKey: '...' } // ✅ Same type as 'openai'
 * }
 * ```
 */
export type ProviderConfig<T extends AppProviderId = AppProviderId> = Omit<AppRuntimeConfig<T>, 'plugins'>

export type { AppProviderId, AppProviderSettingsMap } from './merged'
export { appProviderIds, getAllProviderIds, isRegisteredProviderId } from './merged'
