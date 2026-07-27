import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'

import { applyMigrations } from '@data/db/applyMigrations'
import { type AppliedMigration, readAppliedChain } from '@data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@data/db/restore/checkpoint'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import { ArchiveAdmissionError, BackupCancelledError } from '../errors'
import { sha256FileCancellable } from '../hashing'
import type { BackupManifest } from '../manifest'

/**
 * Migration-chain compatibility + migrate-forward for archive admission
 * (Phase 1b-ii, docs/references/backup/README.md §5.2). Reuses the on-`main`
 * primitives verbatim — `readAppliedChain` (the ONLY legitimate chain source,
 * never the bundled tip), `readMigrationFiles` (the bundled production chain),
 * and `applyMigrations` (the shared migrate path) — so a detached backup DB
 * migrates through the identical code the live DB and the test harness use.
 *
 * The gate is strict and fail-closed:
 * 1. SQLite `integrity_check` proves the staged DB is not corrupt.
 * 2. Its ACTUAL full applied chain must equal the manifest's declared chain
 *    (before any migration) — a DB cannot vouch for a chain it did not apply.
 * 3. The staged chain vs the bundled production chain: EXACT or a strict PREFIX
 *    is accepted; a prefix migrates forward. AHEAD-of or FORKED-from the bundled
 *    chain is rejected (`migrate()` silently no-ops an ahead DB, so we compare
 *    item-wise, never by tip).
 * 4. After migrate-forward, `integrity_check` runs again and the applied chain
 *    must now equal the bundled chain exactly.
 *
 * The manifest's chain/DB metadata are NEVER mutated silently — the sealed final
 * DB hash/size/chain are returned SEPARATELY so the caller can record both the
 * archive's original claim and the post-migration reality.
 */

export type ChainDecision =
  | { readonly kind: 'exact' }
  | { readonly kind: 'prefix' }
  | { readonly kind: 'incompatible'; readonly detail: string }

/**
 * Pure item-wise classification of a source chain against the bundled chain.
 * Exact ⇒ no migration; strict prefix ⇒ migrate forward; a mismatch within the
 * shared prefix is a FORK; a longer source is AHEAD. Both are incompatible.
 */
export function classifyChain(
  source: readonly AppliedMigration[],
  bundled: readonly { folderMillis: number; hash: string }[]
): ChainDecision {
  const shared = Math.min(source.length, bundled.length)
  for (let i = 0; i < shared; i++) {
    if (source[i].folderMillis !== bundled[i].folderMillis || source[i].hash !== bundled[i].hash) {
      return { kind: 'incompatible', detail: `forked at migration #${i}` }
    }
  }
  if (source.length > bundled.length) {
    return { kind: 'incompatible', detail: `ahead of bundled chain by ${source.length - bundled.length}` }
  }
  return source.length === bundled.length ? { kind: 'exact' } : { kind: 'prefix' }
}

function chainsEqual(a: readonly AppliedMigration[], b: readonly { folderMillis: number; hash: string }[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => item.folderMillis === b[i].folderMillis && item.hash === b[i].hash)
}

export interface StagedDbAdmission {
  readonly migratedForward: boolean
  /** The post-state applied chain — equals the bundled production chain. */
  readonly finalChain: readonly AppliedMigration[]
  /** Sealed final DB SHA-256 (recomputed after any migrate-forward). */
  readonly hash: string
  readonly sizeBytes: number
}

function readActualChain(sqlite: Database.Database): AppliedMigration[] {
  try {
    return readAppliedChain(sqlite)
  } catch {
    // No `__drizzle_migrations` table (unmigrated DB) — it cannot match a
    // manifest chain (min length 1), so treat as a chain mismatch.
    throw new ArchiveAdmissionError('chain-mismatch', 'staged database has no applied migration chain')
  }
}

function assertIntegrity(sqlite: Database.Database, when: string): void {
  let result: unknown
  try {
    result = sqlite.pragma('integrity_check', { simple: true })
  } catch {
    throw new ArchiveAdmissionError('db-corrupt', `integrity_check (${when}) failed to run`)
  }
  if (String(result) !== 'ok') {
    throw new ArchiveAdmissionError('db-corrupt', `integrity_check (${when}) not ok`)
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError()
}

/**
 * Fold any WAL frames into the main file and drop WAL mode so the sealed artifact
 * is a clean single file with NO `-wal`/`-shm` sidecars — a hostile archive could
 * ship a WAL-mode DB (or migrate-forward could write through WAL), leaving
 * committed rows in the sidecar where a bare main-file hash would miss them. This
 * mirrors the "checkpoint then hash" invariant in
 * `src/main/data/db/restore/README.md`.
 */
function sealDbFile(sqlite: Database.Database): void {
  try {
    checkpointTruncateAssert(sqlite)
    const mode = String(sqlite.pragma('journal_mode = DELETE', { simple: true }))
    if (mode !== 'delete') {
      throw new ArchiveAdmissionError('db-corrupt', `could not seal staged database journal mode (got ${mode})`)
    }
  } catch (err) {
    if (err instanceof ArchiveAdmissionError) throw err
    // An unexpected checkpoint/journal-mode failure (e.g. a busy assertion) is
    // wrapped content-free rather than leaking the raw SQLite message.
    throw new ArchiveAdmissionError('db-corrupt', 'failed to seal staged database')
  }
}

/**
 * Prove the staged DB is admissible and migrate it forward if it is a strict
 * prefix of the bundled chain. Mutates the DB file at `dbPath` in place; returns
 * the sealed final metadata. Throws {@link ArchiveAdmissionError} on any failure.
 *
 * `trusted_schema=OFF` is set on the hostile connection — SQLite's recommended
 * boundary for an untrusted schema — before any schema is used; extension
 * loading is left at its (disabled) default.
 */
export async function admitStagedDatabase(
  dbPath: string,
  manifest: BackupManifest,
  migrationsFolder: string,
  signal: AbortSignal | undefined
): Promise<StagedDbAdmission> {
  throwIfAborted(signal)
  let sqlite: Database.Database
  try {
    sqlite = new Database(dbPath, { fileMustExist: true })
  } catch {
    throw new ArchiveAdmissionError('db-corrupt', 'staged database could not be opened')
  }

  let migratedForward = false
  let finalChain: readonly AppliedMigration[] = []
  try {
    sqlite.pragma('trusted_schema = OFF')
    assertIntegrity(sqlite, 'pre')

    const actual = readActualChain(sqlite)
    if (!chainsEqual(actual, manifest.migrationChain)) {
      throw new ArchiveAdmissionError('chain-mismatch', 'staged applied chain != manifest.migrationChain')
    }

    const bundled = readMigrationFiles({ migrationsFolder })
    const decision = classifyChain(actual, bundled)
    if (decision.kind === 'incompatible') {
      throw new ArchiveAdmissionError('chain-incompatible', decision.detail)
    }

    if (decision.kind === 'prefix') {
      throwIfAborted(signal) // before the synchronous migration
      try {
        applyMigrations(drizzle({ client: sqlite, casing: 'snake_case' }), migrationsFolder)
      } catch {
        // A staged DB that passed integrity + matched the manifest but cannot be
        // migrated to the bundled chain is not admissible — fail closed within
        // the taxonomy rather than leaking the raw migrator error.
        throw new ArchiveAdmissionError('chain-incompatible', 'migrate-forward failed to apply the bundled chain')
      }
      throwIfAborted(signal) // after the synchronous migration
      assertIntegrity(sqlite, 'post')
      const migrated = readActualChain(sqlite)
      if (!chainsEqual(migrated, bundled)) {
        throw new ArchiveAdmissionError('chain-incompatible', 'migrate-forward did not reach the bundled chain')
      }
      migratedForward = true
      finalChain = migrated
    } else {
      finalChain = actual
    }

    sealDbFile(sqlite)
  } finally {
    sqlite.close()
  }

  // The sealed file must carry NEITHER sidecar before it is hashed — either one
  // would mean committed data lives outside the main file (§ restore README).
  if (existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)) {
    throw new ArchiveAdmissionError('db-corrupt', 'staged database retained a WAL/SHM sidecar after sealing')
  }

  throwIfAborted(signal)
  const hash = await sha256FileCancellable(dbPath, signal)
  const sizeBytes = (await stat(dbPath)).size
  return { migratedForward, finalChain, hash, sizeBytes }
}
