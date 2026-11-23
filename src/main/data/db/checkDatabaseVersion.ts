import type Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import { readAppliedChain } from './restore/appliedChain'

export class DatabaseSchemaTooNewError extends Error {
  constructor(applied: number, bundled: number) {
    super(`Database migration ${applied} is newer than the bundled migration ${bundled}`)
    this.name = 'DatabaseSchemaTooNewError'
  }
}

export function checkDatabaseVersion(sqlite: Database.Database, migrationsFolder: string): void {
  const applied = readAppliedChain(sqlite, { allowMissing: true }).at(-1)
  if (!applied) return

  const bundled = readMigrationFiles({ migrationsFolder }).at(-1)
  if (bundled && applied.folderMillis > bundled.folderMillis) {
    throw new DatabaseSchemaTooNewError(applied.folderMillis, bundled.folderMillis)
  }
}
