import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey, PublicBootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'

import { DefaultPreferences } from './preferenceSchemas'
import type { PreferenceKeyType, UnifiedPreferenceKeyType, UnifiedPreferenceType } from './preferenceTypes'

export const BOOT_CONFIG_PREFIX = 'BootConfig.'

/**
 * Prefix marking the internal boot config namespace (main-process transient
 * state). Keys under it are excluded from the unified preference API — mirrors
 * the type-level `InternalBootConfigKey` convention in `bootConfigTypes.ts`.
 */
const INTERNAL_BOOT_CONFIG_PREFIX = 'temp.'

/**
 * Public boot config keys reachable through the unified preference API.
 * Derived from DefaultBootConfig (the single runtime source of every boot
 * config key) so it stays in sync with the schema automatically.
 */
const PUBLIC_BOOT_CONFIG_KEYS = new Set<string>(
  Object.keys(DefaultBootConfig).filter((key) => !key.startsWith(INTERNAL_BOOT_CONFIG_PREFIX))
)

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

/**
 * Whitelist guard for the unified preference API: true only for a
 * 'BootConfig.'-prefixed key whose underlying boot config key is public.
 * Internal (`temp.*`) and unknown boot config keys return false, keeping
 * main-process-internal state and junk keys off the renderer-facing surface.
 */
export function isPublicBootConfigKey(key: string): key is `BootConfig.${PublicBootConfigKey}` {
  return isBootConfigKey(key) && PUBLIC_BOOT_CONFIG_KEYS.has(toBootConfigKey(key))
}

/** Strip 'BootConfig.'; only a typed or validated key guarantees a BootConfigKey result. */
export function toBootConfigKey(key: `BootConfig.${BootConfigKey}`): BootConfigKey
export function toBootConfigKey(key: string): string
export function toBootConfigKey(key: string): string {
  return key.slice(BOOT_CONFIG_PREFIX.length)
}

/** Unified default value lookup covering both DB preferences and BootConfig */
export function getDefaultValue<K extends UnifiedPreferenceKeyType>(key: K): UnifiedPreferenceType[K] {
  if (isPreferenceKey(key)) {
    // SAFETY: This branch selects the generated DB preference map; its value at key is the same UnifiedPreferenceType entry.
    return DefaultPreferences.default[key] as UnifiedPreferenceType[K]
  }

  const configKey = toBootConfigKey(key)

  // SAFETY: The remaining unified keys are public BootConfig keys; removing their prefix selects the corresponding generated default.
  return DefaultBootConfig[configKey] as UnifiedPreferenceType[K]
}
