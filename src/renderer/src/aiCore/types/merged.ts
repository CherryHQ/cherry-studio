/**
 * Application-Level Provider Type Merge Point
 */

import type { RuntimeConfig } from '@cherrystudio/ai-core/core'
import type { ModelConfig } from '@cherrystudio/ai-core/core/models/types'
import type { RuntimeExecutor } from '@cherrystudio/ai-core/core/runtime'
import type {
  ExtensionConfigToIdResolutionMap,
  ExtensionToSettingsMap,
  ExtractProviderIds,
  ProviderExtensionConfig,
  StringKeys,
  UnionToIntersection
} from '@cherrystudio/ai-core/provider'
import { coreExtensions } from '@cherrystudio/ai-core/provider'

import { extensions } from '../provider/extensions'

type AllExtensions = readonly [...typeof coreExtensions, ...typeof extensions]

type AllExtensionConfigs = AllExtensions[number]['config']

/**
 * All provider extensions merged into one array.
 * Lazy-initialized to avoid circular dependency issues during module loading.
 */
let _allExtensions: AllExtensions | undefined
function getAllExtensions(): AllExtensions {
  if (!_allExtensions) {
    _allExtensions = [...coreExtensions, ...extensions] as unknown as AllExtensions
  }
  return _allExtensions
}

// ==================== Unified Application Types ====================

/**
 * Complete Application Provider ID Type
 */
type KnownAppProviderId = ExtractProviderIds<AllExtensionConfigs>
export type AppProviderId = KnownAppProviderId | (string & {})

/**
 * Application Provider Settings Map
 * 使用 UnionToIntersection 将所有 extension 的 settings map 合并为单一对象类型
 */
export type AppProviderSettingsMap = UnionToIntersection<ExtensionToSettingsMap<AllExtensions[number]>>
// ==================== Runtime Utilities ====================

/**
 * Check if a provider ID belongs to the registered extensions
 */
export function isRegisteredProviderId(id: string): boolean {
  return getAllExtensions().some((ext) => ext.hasProviderId(id))
}

/**
 * Get all registered provider IDs (for debugging/logging)
 */
export function getAllProviderIds(): string[] {
  return getAllExtensions().flatMap((ext) => ext.getProviderIds())
}

type ProviderIdsMap = UnionToIntersection<ExtensionConfigToIdResolutionMap<AllExtensionConfigs>>

/**
 * 应用层 Provider IDs 常量
 * Lazy-initialized to avoid circular dependency issues during module loading.
 */
let _appProviderIds: ProviderIdsMap | undefined
export function getAppProviderIds(): ProviderIdsMap {
  if (!_appProviderIds) {
    const map = {} as ProviderIdsMap

    getAllExtensions().forEach((ext) => {
      const config = ext.config as ProviderExtensionConfig<any, any, any, KnownAppProviderId>
      const name = config.name
      ;(map as Record<string, KnownAppProviderId>)[name] = name

      if (config.aliases) {
        config.aliases.forEach((alias) => {
          ;(map as Record<string, KnownAppProviderId>)[alias] = name
        })
      }

      if (config.variants) {
        config.variants.forEach((variant) => {
          const variantId = `${name}-${variant.suffix}` as KnownAppProviderId
          ;(map as Record<string, KnownAppProviderId>)[variantId] = variantId
        })
      }
    })

    _appProviderIds = map
  }
  return _appProviderIds
}

/**
 * 应用层 Provider IDs 常量（lazy proxy, delegates to getAppProviderIds()）
 */
export const appProviderIds = new Proxy({} as ProviderIdsMap, {
  get(_, prop, receiver) {
    return Reflect.get(getAppProviderIds(), prop, receiver)
  },
  has(_, prop) {
    return Reflect.has(getAppProviderIds(), prop)
  },
  ownKeys() {
    return Reflect.ownKeys(getAppProviderIds())
  },
  getOwnPropertyDescriptor(_, prop) {
    return Object.getOwnPropertyDescriptor(getAppProviderIds(), prop)
  }
})

export type AppModelConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> =
  ModelConfig<T, AppProviderSettingsMap>

/**
 * 应用层运行时配置 - 支持完整的 App provider IDs 和 settings
 */
export type AppRuntimeConfig<T extends StringKeys<AppProviderSettingsMap> = StringKeys<AppProviderSettingsMap>> =
  RuntimeConfig<AppProviderSettingsMap, T>

/**
 * 应用层运行时执行器 - 支持完整的 App provider IDs 和 settings
 */
export type AppRuntimeExecutor = RuntimeExecutor<AppProviderSettingsMap>
