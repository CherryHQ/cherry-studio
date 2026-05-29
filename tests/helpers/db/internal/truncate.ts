import type { DbType } from '@data/db/types'
import type { Client } from '@libsql/client'
import { sql } from 'drizzle-orm'

interface MasterRow {
  name: string
}

/**
 * Delete every user table's rows, leaving schema and migration journal
 * intact. Called by the harness's `beforeEach` hook.
 *
 * Implementation notes:
 * - FK is toggled via `client.execute` (one-shot on the current connection)
 *   instead of `client.setPragma` to avoid growing the patched
 *   `#connectionPragmas` replay list by two entries per test.
 * - `__drizzle_migrations` is preserved so the schema stays set up across
 *   tests.
 * - FTS5 virtual tables and their shadow tables (`_data`, `_config`,
 *   `_docsize`, `_idx`) are skipped; the base table's AFTER DELETE trigger
 *   cascades FTS cleanup (SQLite-standard behaviour).
 * - `sqlite_sequence` may not exist if no AUTOINCREMENT columns are defined;
 *   we ignore that error.
 */
export async function truncateAll(db: DbType, client: Client): Promise<void> {
  await client.execute('PRAGMA foreign_keys = OFF')
  try {
    const rows = await db.all<MasterRow>(
      sql.raw(
        "SELECT name FROM sqlite_master WHERE type='table' " +
          "AND name NOT LIKE 'sqlite_%' " +
          "AND name NOT LIKE '__drizzle%' " +
          "AND name NOT LIKE '%_fts' " +
          "AND name NOT LIKE '%_fts_%'"
      )
    )

    await db.transaction(async (tx) => {
      for (const { name } of rows) {
        await tx.run(sql.raw(`DELETE FROM "${name}"`))
      }
      try {
        await tx.run(sql.raw('DELETE FROM sqlite_sequence'))
      } catch {
        // sqlite_sequence may not exist if no AUTOINCREMENT columns defined
      }
    })
  } finally {
    await client.execute('PRAGMA foreign_keys = ON')
  }
}
