import { application } from '@application'
import { isDev } from '@main/core/platform'
import { readPreferenceValueFromDatabaseFile } from '@main/data/readPreferenceValueFromDatabaseFile'

const DEVELOPER_MODE_PREFERENCE_KEY = 'app.developer_mode.enabled'

function parseStoredBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    if (value === 'true') return true
    try {
      return JSON.parse(value) === true
    } catch {
      return false
    }
  }
  return false
}

/**
 * Read developer mode from SQLite before PreferenceService initializes.
 * Used only for lifecycle @Conditional registration; changes require restart.
 */
export function isDeveloperModeEnabledAtStartup(): boolean {
  const value = readPreferenceValueFromDatabaseFile(
    application.getPath('app.database.file'),
    DEVELOPER_MODE_PREFERENCE_KEY
  )
  return parseStoredBoolean(value)
}

export function isMainNetworkDevtoolsEnabled(): boolean {
  return isDev || isDeveloperModeEnabledAtStartup()
}
