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

/**
 * All provider extensions merged into one array
 */
const allExtensions = [...coreExtensions, ...extensions] as const

type AllExtensionConfigs = (typeof allExtensions)[number]['config']

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
export type AppProviderSettingsMap = UnionToIntersection<ExtensionToSettingsMap<(typeof allExtensions)[number]>>
// ==================== Runtime Utilities ====================

/**
 * Check if a provider ID belongs to the registered extensions
 */
export function isRegisteredProviderId(id: string): boolean {
  return allExtensions.some((ext) => ext.hasProviderId(id))
}

/**
 * Get all registered provider IDs (for debugging/logging)
 */
export function getAllProviderIds(): string[] {
  return allExtensions.flatMap((ext) => ext.getProviderIds())
}

type ProviderIdsMap = UnionToIntersection<ExtensionConfigToIdResolutionMap<AllExtensionConfigs>>

const appProviderAliases = {
  longcat: 'longcat'
} as const satisfies Record<string, AppProviderId>

type AppProviderIdsMap = ProviderIdsMap & typeof appProviderAliases

/**
 * 应用层 Provider IDs 常量
 */
function buildAppProviderIds(): AppProviderIdsMap {
  const map = {} as AppProviderIdsMap
  const mutableMap = map as Record<string, AppProviderId>

  allExtensions.forEach((ext) => {
    const config = ext.config as ProviderExtensionConfig<any, any, KnownAppProviderId>
    const name = config.name
    mutableMap[name] = name

    if (config.aliases) {
      config.aliases.forEach((alias) => {
        mutableMap[alias] = name
      })
    }

    if (config.variants) {
      config.variants.forEach((variant) => {
        // 变体自反映射：'azure-responses' -> 'azure-responses'
        // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
        const variantId = `${name}-${variant.suffix}` as KnownAppProviderId
        mutableMap[variantId] = variantId
      })
    }
  })

  Object.assign(map, appProviderAliases)

  return map
}

export const appProviderIds = buildAppProviderIds()

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
