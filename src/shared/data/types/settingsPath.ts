export type SettingsPath = '/settings' | `/settings?${string}` | '/settings/provider' | `/settings/${string}`

export const DEFAULT_SETTINGS_PATH: SettingsPath = '/settings/provider'

export function isSettingsPath(value: unknown): value is SettingsPath {
  return (
    typeof value === 'string' &&
    (value === '/settings' || value.startsWith('/settings?') || value.startsWith('/settings/'))
  )
}

export function normalizeSettingsPath(value: unknown): SettingsPath {
  return isSettingsPath(value) ? value : DEFAULT_SETTINGS_PATH
}
