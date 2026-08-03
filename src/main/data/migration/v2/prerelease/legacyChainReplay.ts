/**
 * Replays the frozen alpha/beta schema chain so a pre-release database can be
 * handed to the current one.
 *
 * The v2 storage consolidation (#17553) regenerated 28 incremental migrations
 * into a single initial migration. That rewrote every hash and timestamp the
 * current chain compares against, so a pre-release database — which stopped
 * anywhere between step 15 (alpha.1) and step 28 — can no longer be advanced by
 * `applyMigrations()`: drizzle decides what to run purely from `created_at`, and
 * the regenerated `0000` is stamped *later* than the old chain's last step, so
 * it would re-run `CREATE TABLE` against tables that already exist.
 *
 * This module closes that gap in one transaction: apply the legacy steps the
 * database has not seen, then replace its bookkeeping with the single row the
 * current chain expects. The end state of the legacy chain is structurally
 * identical to the regenerated `0000` (see the sibling README), so stamping that
 * row is truthful — the next `applyMigrations()` correctly skips `0000` and
 * resumes at `0001`.
 *
 * Deleted together with the rest of `../prerelease/`.
 */

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import Database from 'better-sqlite3'
import crypto from 'crypto'

const logger = loggerService.withContext('LegacyChainReplay')

const BOOKKEEPING_TABLE = '__drizzle_migrations'
const STATEMENT_SEPARATOR = '--> statement-breakpoint'

interface JournalEntry {
  readonly tag: string
  readonly when: number
}

/** The single bookkeeping row that makes the current chain resume at `0001`. */
export interface ChainMarker {
  readonly hash: string
  readonly createdAt: number
}

export interface ReplayInput {
  /** Database to advance, in place. */
  readonly databaseFile: string
  /** Frozen alpha/beta chain. */
  readonly legacyMigrationsFolder: string
  /** Current chain, read only for the marker it expects. */
  readonly migrationsFolder: string
}

/**
 * Bring `databaseFile` from wherever it stopped in the legacy chain up to the
 * point the current chain takes over.
 *
 * Atomic and resumable: everything happens in one transaction, and a database
 * that already carries the marker is left untouched, so a crash between this
 * call and the file move costs nothing on the next launch.
 *
 * @returns how many legacy steps were applied (0 when already adopted).
 * @throws if the database carries no bookkeeping at all — that is not a
 *   pre-release database, and guessing at its schema could destroy data.
 */
export function replayLegacyChain(input: ReplayInput): number {
  const { databaseFile, legacyMigrationsFolder, migrationsFolder } = input

  const marker = readChainMarker(migrationsFolder)
  const legacyEntries = readJournal(legacyMigrationsFolder)

  // `fileMustExist` matters: the default would CREATE an empty database at a
  // path that holds nothing, and the "no bookkeeping" error below would then
  // describe a file this function had just conjured.
  const sqlite = new Database(databaseFile, { fileMustExist: true })
  try {
    const lastApplied = readLastAppliedTimestamp(sqlite)
    if (lastApplied === null) {
      throw new Error(`Pre-release database carries no ${BOOKKEEPING_TABLE} bookkeeping: ${databaseFile}`)
    }

    if (lastApplied >= marker.createdAt) {
      logger.info('Database already carries the current-chain marker, nothing to replay', { databaseFile })
      return 0
    }

    const pending = legacyEntries.filter((entry) => entry.when > lastApplied)
    logger.info('Replaying legacy chain', { databaseFile, lastApplied, pending: pending.length })

    // Foreign keys must be off OUTSIDE the transaction. Half of these steps
    // recreate a table (CREATE __new_x → INSERT SELECT → DROP x → RENAME), and
    // the DROP fires every child's ON DELETE CASCADE while enforcement is on —
    // the defect fixed in #17569, which shipped after all of these files. SQLite
    // documents the pragma as a no-op once a transaction is open, so setting it
    // here is the only placement that takes effect.
    const enforced = isForeignKeysEnforced(sqlite)
    sqlite.pragma('foreign_keys = OFF')

    try {
      sqlite.transaction(() => {
        for (const entry of pending) {
          const file = path.join(legacyMigrationsFolder, `${entry.tag}.sql`)
          for (const statement of fs.readFileSync(file, 'utf-8').split(STATEMENT_SEPARATOR)) {
            const trimmed = statement.trim()
            if (trimmed) sqlite.exec(trimmed)
          }
        }
        // Replace the bookkeeping wholesale rather than appending: the legacy
        // rows describe files this build no longer ships, and the current chain
        // only ever reads the row with the highest created_at.
        sqlite.exec(`DELETE FROM ${BOOKKEEPING_TABLE}`)
        sqlite
          .prepare(`INSERT INTO ${BOOKKEEPING_TABLE} ("hash", "created_at") VALUES (?, ?)`)
          .run(marker.hash, marker.createdAt)
      })()
    } finally {
      sqlite.pragma(`foreign_keys = ${enforced ? 'ON' : 'OFF'}`)
    }

    return pending.length
  } finally {
    // Closing checkpoints the WAL, so the caller can move the file safely.
    sqlite.close()
  }
}

/**
 * The bookkeeping row the current chain's first migration would have written.
 * `created_at` is its journal timestamp — the value drizzle compares against —
 * and the hash is the digest drizzle computes from the file itself.
 */
export function readChainMarker(migrationsFolder: string): ChainMarker {
  const entries = readJournal(migrationsFolder)
  const first = entries[0]
  if (!first) {
    throw new Error(`Current migration chain has no entries: ${migrationsFolder}`)
  }
  const sql = fs.readFileSync(path.join(migrationsFolder, `${first.tag}.sql`), 'utf-8')
  return { hash: crypto.createHash('sha256').update(sql).digest('hex'), createdAt: first.when }
}

/** Journal entries, oldest first — the order drizzle applies them in. */
function readJournal(migrationsFolder: string): JournalEntry[] {
  const journalFile = path.join(migrationsFolder, 'meta', '_journal.json')
  const parsed = JSON.parse(fs.readFileSync(journalFile, 'utf-8')) as { entries?: JournalEntry[] }
  return [...(parsed.entries ?? [])].sort((a, b) => a.when - b.when)
}

/** `null` when the database has no bookkeeping table, or an empty one. */
function readLastAppliedTimestamp(sqlite: Database.Database): number | null {
  const table = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(BOOKKEEPING_TABLE)
  if (!table) return null

  const row = sqlite.prepare(`SELECT created_at FROM ${BOOKKEEPING_TABLE} ORDER BY created_at DESC LIMIT 1`).get() as
    | { created_at: number | string | null }
    | undefined
  if (!row || row.created_at === null) return null

  return Number(row.created_at)
}

function isForeignKeysEnforced(sqlite: Database.Database): boolean {
  const rows = sqlite.pragma('foreign_keys') as Array<{ foreign_keys?: number }>
  return Number(rows[0]?.foreign_keys ?? 0) === 1
}
