import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { CUSTOM_SQL_STATEMENTS } from './customSqls'
import type { DbType } from './types'

/**
 * Apply drizzle migrations, then the custom SQL drizzle cannot manage
 * (FTS5 virtual tables, triggers — all idempotent, see customSqls.ts).
 *
 * Pure function over an injected connection so all three consumers share one
 * migration path: DbService.onInit (live DB), the test harness (throwaway DB),
 * and the backup restore pipeline (detached work.sqlite migrate-forward).
 */
export function applyMigrations(db: DbType, migrationsFolder: string): void {
  migrate(db, { migrationsFolder })
  for (const statement of CUSTOM_SQL_STATEMENTS) {
    db.run(sql.raw(statement))
  }
}
