import type { DbType } from '@data/db/types'
import type Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'

interface MasterRow {
  name: string
}

/**
 * Delete every user table's rows, leaving schema and migration journal
 * intact. Called by the harness's `beforeEach` hook.
 *
 * Implementation notes:
 * - FK is toggled via `sqlite.pragma` (one-shot on the connection) so
 *   enforcement is restored right after the truncation.
 * - `__drizzle_migrations` is preserved so the schema stays set up across
 *   tests.
 * - FTS5 virtual tables and their shadow tables (`_data`, `_config`,
 *   `_docsize`, `_idx`) are skipped; the base table's AFTER DELETE trigger
 *   cascades FTS cleanup (SQLite-standard behaviour).
 * - `sqlite_sequence` may not exist if no AUTOINCREMENT columns are defined;
 *   we ignore that error.
 */
export function truncateAll(db: DbType, sqlite: Database.Database): void {
  sqlite.pragma('foreign_keys = OFF')
  try {
    const rows = db.all<MasterRow>(
      sql.raw(
        "SELECT name FROM sqlite_master WHERE type='table' " +
          "AND name NOT LIKE 'sqlite_%' " +
          "AND name NOT LIKE '__drizzle%' " +
          "AND name NOT LIKE '%_fts' " +
          "AND name NOT LIKE '%_fts_%'"
      )
    )

    db.transaction((tx) => {
      for (const { name } of rows) {
        tx.run(sql.raw(`DELETE FROM "${name}"`))
      }
      try {
        tx.run(sql.raw('DELETE FROM sqlite_sequence'))
      } catch {
        // sqlite_sequence may not exist if no AUTOINCREMENT columns defined
      }
    })
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
}
