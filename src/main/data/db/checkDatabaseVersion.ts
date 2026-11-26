import type Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import { FatalStartupError } from '@main/core/lifecycle'

import { readAppliedChain } from './restore/appliedChain'

export class DatabaseSchemaTooNewError extends FatalStartupError {
  constructor(applied: number, bundled: number) {
    super(
      `Database migration ${applied} is newer than the bundled migration ${bundled}`,
      'dialog.database_upgrade_required'
    )
    this.name = 'DatabaseSchemaTooNewError'
  }
}

export function checkDatabaseVersion(sqlite: Database.Database, migrationsFolder: string): void {
  const applied = readAppliedChain(sqlite, { allowMissing: true }).at(-1)
  if (!applied) return

  const bundled = readMigrationFiles({ migrationsFolder })
  const newestBundled = Math.max(...bundled.map((migration) => migration.folderMillis))
  if (bundled.length > 0 && applied.folderMillis > newestBundled) {
    throw new DatabaseSchemaTooNewError(applied.folderMillis, newestBundled)
  }
}
