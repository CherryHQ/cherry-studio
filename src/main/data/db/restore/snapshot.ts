import fs from 'node:fs'
import path from 'node:path'

import type Database from 'better-sqlite3'

/**
 * Transaction-consistent copy of the database into a fresh file via
 * `VACUUM INTO` (run outside any transaction — SQLite rejects it inside one).
 * The copy carries everything including `__drizzle_migrations`, which is what
 * lets the promotion gate later prefix-compare the applied chain.
 *
 * The target must not exist: SQLite would fail anyway, but failing before
 * with the offending path beats its terser error. Runs synchronously on the
 * caller's thread — the restore flow blocks the UI by design.
 */
export function snapshotTo(sqlite: Database.Database, targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    throw new Error(`snapshotTo: target already exists: ${targetPath}`)
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  sqlite.prepare('VACUUM INTO ?').run(targetPath)
}
