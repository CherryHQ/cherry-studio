import type { BootConfigSchema } from './bootConfigSchemas'

export type BootConfigKey = keyof BootConfigSchema

/**
 * Boot config keys reserved for main-process-internal transient state.
 *
 * The `temp.*` namespace holds ephemeral runtime state (single in-flight
 * operations, never backed up or synced). It must never be reachable through
 * the unified preference API — renderer preload, hooks, or cross-window sync —
 * because restoring a stale `temp.*` entry can cause silent data corruption.
 * Owning main-process modules use `bootConfigService` directly instead.
 *
 * Keep this in sync with the runtime whitelist derived in `preferenceUtils.ts`;
 * both key off the `temp.` prefix.
 */
export type InternalBootConfigKey = Extract<BootConfigKey, `temp.${string}`>

/** Boot config keys exposed through the unified preference API. */
export type PublicBootConfigKey = Exclude<BootConfigKey, InternalBootConfigKey>

/** Auto-prefix PUBLIC boot config keys with 'BootConfig.' for PreferenceService type integration */
export type BootConfigPreferenceKeys = {
  [K in PublicBootConfigKey as `BootConfig.${K & string}`]: BootConfigSchema[K]
}
