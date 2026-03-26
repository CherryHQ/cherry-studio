import type { BootConfigSchema } from './bootConfigSchemas'

export type BootConfigKey = keyof BootConfigSchema

/** Auto-prefix boot config keys with 'BootConfig.' for PreferenceService type integration */
export type BootConfigPreferenceKeys = {
  [K in BootConfigKey as `BootConfig.${K & string}`]: BootConfigSchema[K]
}
