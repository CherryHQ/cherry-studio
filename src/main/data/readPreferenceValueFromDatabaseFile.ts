import Database from 'better-sqlite3'
import { getTableName } from 'drizzle-orm'

import { preferenceTable } from './db/schemas/preference'

const PREFERENCE_TABLE = getTableName(preferenceTable)
const DEFAULT_PREFERENCE_SCOPE = 'default'

/**
 * Synchronous read of one preference row from the on-disk SQLite file.
 * For use before DbService / PreferenceService are available (e.g. lifecycle @Conditional).
 */
export function readPreferenceValueFromDatabaseFile(
  dbPath: string,
  key: string,
  scope = DEFAULT_PREFERENCE_SCOPE
): unknown | undefined {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare(`SELECT value FROM ${PREFERENCE_TABLE} WHERE scope = ? AND key = ?`).get(scope, key) as
        | { value: unknown }
        | undefined
      return row?.value
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}
