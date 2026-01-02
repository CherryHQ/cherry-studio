/**
 * This type definition file is only for renderer.
 * It cannot be migrated to @renderer/types since files within it are actually being used by both main and renderer.
 * If we do that, main would throw an error because it cannot import a module which imports a type from a browser-enviroment-only package.
 * (ai-core package is set as browser-enviroment-only)
 *
 * TODO: We should separate them clearly. Keep renderer only types in renderer, and main only types in main, and shared types in shared.
 */

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
