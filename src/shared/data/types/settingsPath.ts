export type SettingsPath = '/settings' | `/settings?${string}` | '/settings/provider' | `/settings/${string}`

export const DEFAULT_SETTINGS_PATH: SettingsPath = '/settings/provider'

export function isSettingsPath(value: unknown): value is SettingsPath {
  return (
    typeof value === 'string' &&
    (value === '/settings' || value.startsWith('/settings?') || value.startsWith('/settings/'))
  )
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Navigation inputs must be checked against allowed settings routes before choosing a fallback.
export function normalizeSettingsPath(value: unknown): SettingsPath {
  return isSettingsPath(value) ? value : DEFAULT_SETTINGS_PATH
}
