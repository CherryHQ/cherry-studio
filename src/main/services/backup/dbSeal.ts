import { existsSync } from 'node:fs'

import { checkpointTruncateAssert } from '@data/db/restore/checkpoint'
import type Database from 'better-sqlite3'

import { DbSealError } from './errors'

/**
 * The sealing invariant for every detached SQLite artifact Backup v2 produces or
 * consumes (docs/references/backup/README.md §5.1,
 * src/main/data/db/restore/README.md).
 *
 * A backup database is identified by the SHA-256 of its MAIN FILE, so no
 * committed row may live anywhere else. Sealing therefore folds any WAL frames
 * back into the main file, leaves WAL mode, and proves both sidecars are gone
 * before the file is hashed. Archive admission and portable materialization both
 * seal, so the invariant lives here once rather than drifting between them.
 */

/** SQLite `integrity_check`. `when` labels the call site (`pre`/`post`) in the error only. */
export function assertDbIntegrity(sqlite: Database.Database, when: string): void {
  let result: unknown
  try {
    result = sqlite.pragma('integrity_check', { simple: true })
  } catch {
    throw new DbSealError('integrity', `integrity_check (${when}) failed to run`)
  }
  if (String(result) !== 'ok') {
    throw new DbSealError('integrity', `integrity_check (${when}) not ok`)
  }
}

/**
 * Fold the WAL into the main file and drop WAL mode.
 *
 * Both halves matter: a hostile archive can ship a WAL-mode database, and any
 * migrate-forward or sanitation pass writes through the WAL — either way,
 * committed rows would otherwise sit in a sidecar that a main-file hash cannot
 * see. On a database already in a rollback-journal mode the checkpoint is a
 * no-op (`log == checkpointed == -1`) rather than a failure.
 */
export function sealDetachedDb(sqlite: Database.Database): void {
  try {
    checkpointTruncateAssert(sqlite)
  } catch (err) {
    // checkpointTruncateAssert's message is pragma counters only, safe to carry.
    throw new DbSealError('checkpoint', err instanceof Error ? err.message : 'wal_checkpoint(TRUNCATE) failed')
  }

  let mode: string
  try {
    mode = String(sqlite.pragma('journal_mode = DELETE', { simple: true }))
  } catch {
    throw new DbSealError('journal-mode', 'journal_mode could not be set')
  }
  if (mode !== 'delete') {
    throw new DbSealError('journal-mode', `journal mode is ${mode} after sealing`)
  }
}

/**
 * Prove the sealed file carries neither sidecar. Called after the connection is
 * closed: a live handle keeps `-shm` mapped even once the WAL is folded in.
 */
export function assertNoDbSidecars(dbPath: string): void {
  if (existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)) {
    throw new DbSealError('sidecar', 'database retained a WAL/SHM sidecar after sealing')
  }
}
