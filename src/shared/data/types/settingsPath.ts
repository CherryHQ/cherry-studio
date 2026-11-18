import * as z from 'zod'

export type SettingsPath = '/settings' | `/settings?${string}` | '/settings/provider' | `/settings/${string}`

export const DEFAULT_SETTINGS_PATH: SettingsPath = '/settings/provider'

export function isSettingsPath(value: unknown): value is SettingsPath {
  return (
    typeof value === 'string' &&
    (value === '/settings' || value.startsWith('/settings?') || value.startsWith('/settings/'))
  )
}

export const normalizeSettingsPath = z.custom<SettingsPath>(isSettingsPath).catch(DEFAULT_SETTINGS_PATH).parse
