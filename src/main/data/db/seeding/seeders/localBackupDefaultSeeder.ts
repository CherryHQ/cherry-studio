import { and, eq, inArray } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const LOCAL_BACKUP_DEFAULTS = [
  { key: 'data.backup.local.auto_sync', value: true },
  { key: 'data.backup.local.sync_interval', value: 1440 },
  { key: 'data.backup.local.max_backups', value: 7 }
] as const

/** Any of these being set means the user made a backup decision we must not overwrite. */
const USER_CONFIGURED_KEYS = [
  'data.backup.local.dir',
  'data.backup.webdav.auto_sync',
  'data.backup.s3.auto_sync',
  'data.backup.nutstore.auto_sync'
] as const

function isConfigured(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value === true
}

/**
 * Turns local backups on for installations that predate them being default-on — but only where the
 * user never configured any backup at all, so an existing choice is never overridden.
 */
export class LocalBackupDefaultSeeder implements ISeeder {
  readonly name = 'localBackupDefault'
  readonly description = 'Enable daily local backups for installations that never configured one'
  readonly version = hashObject(LOCAL_BACKUP_DEFAULTS)

  run(db: DbType): void {
    const configuredRows = db
      .select({ key: preferenceTable.key, value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), inArray(preferenceTable.key, [...USER_CONFIGURED_KEYS])))
      .all()

    if (configuredRows.some((row) => isConfigured(row.value))) return

    for (const { key, value } of LOCAL_BACKUP_DEFAULTS) {
      db.insert(preferenceTable)
        .values({ scope: 'default', key, value })
        .onConflictDoUpdate({
          target: [preferenceTable.scope, preferenceTable.key],
          set: { value }
        })
        .run()
    }
  }
}
