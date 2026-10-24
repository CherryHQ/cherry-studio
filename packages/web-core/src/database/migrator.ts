import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { MigrationConfig } from 'drizzle-orm/migrator'
import type { SQLiteSession, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import migrations from 'virtual:cherry-studio-migrations'

interface DrizzleInternals {
  dialect: SQLiteSyncDialect
  session: SQLiteSession<'sync', unknown, Record<string, never>, Record<string, never>>
}

/**
 * Browser replacement for `drizzle-orm/better-sqlite3/migrator`, aliased in by the
 * Worker build. Drizzle's version reads the migration folder from disk; here the
 * same entries are bundled at build time, so `config.migrationsFolder` is unused.
 */
export function migrate(db: BetterSQLite3Database, config: MigrationConfig): void {
  const { dialect, session } = db as unknown as DrizzleInternals
  dialect.migrate(migrations, session, config)
}
