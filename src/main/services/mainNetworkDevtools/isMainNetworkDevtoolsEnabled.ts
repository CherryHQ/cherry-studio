import Database from 'better-sqlite3'

import { application } from '@application'
import { isDev } from '@main/core/platform'

const DEVELOPER_MODE_PREFERENCE_KEY = 'app.developer_mode.enabled'
const DEFAULT_PREFERENCE_SCOPE = 'default'

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
  try {
    const dbPath = application.getPath('app.database.file')
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const row = db
        .prepare('SELECT value FROM preference WHERE scope = ? AND key = ?')
        .get(DEFAULT_PREFERENCE_SCOPE, DEVELOPER_MODE_PREFERENCE_KEY) as { value: unknown } | undefined
      return row ? parseStoredBoolean(row.value) : false
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

export function isMainNetworkDevtoolsEnabled(): boolean {
  return isDev || isDeveloperModeEnabledAtStartup()
}
