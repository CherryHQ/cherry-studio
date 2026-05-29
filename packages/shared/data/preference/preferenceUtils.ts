import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'

import { DefaultPreferences } from './preferenceSchemas'
import type { PreferenceKeyType, UnifiedPreferenceKeyType, UnifiedPreferenceType } from './preferenceTypes'

export const BOOT_CONFIG_PREFIX = 'BootConfig.'

/**
 * Type guard: narrow UnifiedPreferenceKeyType to PreferenceKeyType.
 * Use in generic methods (get/set) where the else branch needs PreferenceKeyType narrowing.
 */
export function isPreferenceKey(key: UnifiedPreferenceKeyType): key is PreferenceKeyType {
  return !key.startsWith(BOOT_CONFIG_PREFIX)
}

/**
 * Check if a key has the 'BootConfig.' prefix.
 * Accepts plain string (from Object.entries) — use in setMultiple-style iteration.
 */
export function isBootConfigKey(key: string): boolean {
  return key.startsWith(BOOT_CONFIG_PREFIX)
}

/** Strip 'BootConfig.' prefix and return the underlying BootConfigKey */
export function toBootConfigKey(key: string): BootConfigKey {
  return key.slice(BOOT_CONFIG_PREFIX.length) as BootConfigKey
}

/** Unified default value lookup covering both DB preferences and BootConfig */
export function getDefaultValue<K extends UnifiedPreferenceKeyType>(key: K): UnifiedPreferenceType[K] {
  if (isPreferenceKey(key)) {
    return DefaultPreferences.default[key] as UnifiedPreferenceType[K]
  }
  const configKey = toBootConfigKey(key)
  return DefaultBootConfig[configKey] as UnifiedPreferenceType[K]
}
