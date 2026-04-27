/**
 * Auto-generated boot config mappings from classification.json
 * Generated at: 2026-04-27T08:42:50.291Z
 *
 * This file contains pure mapping relationships without default values.
 * Default values are managed in packages/shared/data/bootConfig/bootConfigSchemas.ts
 *
 * === AUTO-GENERATED CONTENT START ===
 */

import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'

/**
 * ElectronStore映射关系 - 简单一层结构
 *
 * ElectronStore没有嵌套，originalKey直接对应configManager.get(key)
 */
export const BOOT_CONFIG_ELECTRON_STORE_MAPPINGS: ReadonlyArray<{ originalKey: string; targetKey: BootConfigKey }> =
  [] as const

/**
 * Redux Store映射关系 - 按category分组，支持嵌套路径
 *
 * Redux Store可能有children结构，originalKey可能包含嵌套路径
 */
export const BOOT_CONFIG_REDUX_MAPPINGS = {
  settings: [
    {
      originalKey: 'disableHardwareAcceleration',
      targetKey: 'app.disable_hardware_acceleration'
    }
  ]
} as const

/**
 * Dexie Settings映射关系 - 简单KV结构
 */
export const BOOT_CONFIG_DEXIE_SETTINGS_MAPPINGS: ReadonlyArray<{ originalKey: string; targetKey: BootConfigKey }> =
  [] as const

/**
 * localStorage映射关系 - 简单KV结构
 */
export const BOOT_CONFIG_LOCALSTORAGE_MAPPINGS: ReadonlyArray<{ originalKey: string; targetKey: BootConfigKey }> =
  [] as const

// === AUTO-GENERATED CONTENT END ===

/**
 * 映射统计:
 * - ElectronStore项: 0
 * - Redux Store项: 1
 * - Redux分类: settings
 * - DexieSettings项: 0
 * - localStorage项: 0
 * - 总配置项: 1
 */
