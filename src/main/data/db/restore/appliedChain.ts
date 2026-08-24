import type Database from 'better-sqlite3'

/** One applied migration: `created_at` is the folder's millis prefix, `hash` the file-content hash. */
export interface AppliedMigration {
  folderMillis: number
  hash: string
}

/**
 * Read the COMPLETE applied-migration sequence from a database's
 * `__drizzle_migrations` table, in application order.
 *
 * This is the only legitimate source for a restore journal's `chain`: filling
 * it from the app's bundled migration list (`readMigrationFiles`) would let a
 * forked or ahead-of-code database vouch for itself — drizzle's migrate() is
 * a silent no-op when the DB is ahead (`created_at < folderMillis` guard in
 * its dialect), so the bundled list can be a strict subset of what the DB
 * actually applied. The gate prefix-compares this sequence against the
 * bundled one; a fork (A B′ C vs A B C) differs item-wise even when tips match.
 */
export function readAppliedChain(sqlite: Database.Database): AppliedMigration[] {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!table) {
    throw new Error('readAppliedChain: no __drizzle_migrations table — an unmigrated database cannot be journaled')
  }
  const rows = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all() as Array<{
    hash: string
    created_at: number | string
  }>
  return rows.map((row) => ({ folderMillis: Number(row.created_at), hash: row.hash }))
}
