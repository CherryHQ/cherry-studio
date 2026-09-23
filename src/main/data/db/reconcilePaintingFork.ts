import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { DbType } from './types'

const FORK_HASH = '07c70858652064977602483ec3bb7a53a8cfa8361ae53741d06a600afe12b0fe'
const IMAGE_SCHEMA_HASH = '906507d76a04cd3489bb311a796c80895d40fb425e7c99f98db67b1e842efa11'

/** Reconcile the shipped Properties 2.1 image migration without replaying its columns. */
export function reconcilePaintingFork(db: DbType, migrationsFolder: string): void {
  if (!db.get(sql`SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'`)) return
  const applied = db.all<{ hash: string; created_at: number }>(
    sql`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`
  )
  if (applied.length !== 25 || applied[24].hash !== FORK_HASH || Number(applied[24].created_at) !== 1789834951491)
    return
  const canonical = readMigrationFiles({ migrationsFolder })
  if (
    canonical.length < 26 ||
    canonical[25].hash !== IMAGE_SCHEMA_HASH ||
    applied
      .slice(0, 24)
      .some((row, i) => row.hash !== canonical[i].hash || Number(row.created_at) !== canonical[i].folderMillis)
  ) {
    throw new Error('Unrecognized painting migration baseline; preserve the database and reconcile explicitly')
  }
  const columns = new Set(db.all<{ name: string }>(sql`PRAGMA table_info(painting)`).map((row) => row.name))
  if (
    ![
      'project_id',
      'parent_id',
      'step_number',
      'source_file_id',
      'operation',
      'params',
      'step_status',
      'step_error',
      'selected_step_id',
      'selected_file_id'
    ].every((name) => columns.has(name))
  ) {
    throw new Error('Painting migration ledger does not match the stored schema')
  }
  db.transaction((tx) => {
    for (const statement of canonical[24].sql) tx.run(sql.raw(statement))
    tx.run(sql`DELETE FROM __drizzle_migrations WHERE hash = ${FORK_HASH}`)
    for (const entry of canonical.slice(24, 26))
      tx.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${entry.hash}, ${entry.folderMillis})`)
  })
}
