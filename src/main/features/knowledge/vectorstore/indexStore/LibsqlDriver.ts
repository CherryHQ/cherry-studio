import { pathToFileURL } from 'node:url'

import { type Client, createClient, type InValue, type ResultSet } from '@libsql/client'
import { loggerService } from '@logger'
import { Mutex } from 'async-mutex'

import type { SqliteDriver, SqliteReclaimOutcome, SqliteTransaction, SqlQueryResult, SqlValue } from './types'

const logger = loggerService.withContext('LibsqlDriver')

/**
 * VACUUM in {@link LibsqlDriver.reclaim} only when the freelist is BOTH a large
 * fraction of the file AND past an absolute floor. The fraction skips rewriting a
 * huge index to reclaim a relatively tiny delete (whose freed pages a later index
 * would reuse anyway); the floor skips the whole-file-rewrite block when there is
 * little to actually return. Below either bound, reclaim just truncates the WAL.
 */
const VACUUM_MIN_FREELIST_RATIO = 0.2
const VACUUM_MIN_FREED_BYTES = 8 * 1024 * 1024

function toQueryResult(result: ResultSet): SqlQueryResult {
  const rows = result.rows.map((row) => {
    const record: Record<string, SqlValue> = {}
    for (const column of result.columns) {
      record[column] = row[column] as SqlValue
    }
    return record
  })
  return { rows }
}

/** SqliteDriver backed by a libsql Client (the only engine today, see §5.6). */
export class LibsqlDriver implements SqliteDriver {
  private closed = false
  // Serializes our own write transactions on this client. @libsql/client's
  // transaction() nullifies its internal connection and lazily opens a new one,
  // so concurrent `client.transaction('write')` calls each BEGIN IMMEDIATE on a
  // separate connection and all but the first hit SQLITE_BUSY (upstream issue
  // #288). A FIFO mutex (same fix as DbService.withWriteTx) makes them queue.
  // Per-instance: each base's index.sqlite has its own client, so writes to
  // different bases never block each other.
  private readonly writeMutex = new Mutex()

  /**
   * @param client the libsql client backing this driver.
   * @param serializedSingleConnection run transactions as manual BEGIN IMMEDIATE / COMMIT /
   *   ROLLBACK on this client's single connection instead of `client.transaction('write')`.
   *
   *   @libsql/client's `transaction('write')` detaches the internal connection (`#db = null`) and
   *   hands it to the tx object, whose commit()/rollback() issue COMMIT/ROLLBACK but never close
   *   that connection — every transaction() thus orphans a still-open file handle that only
   *   GC/finalizers reclaim (upstream lib-cjs/sqlite3.js). A loop that runs one transaction per
   *   item (the migration's per-material rebuild) orphans one handle per item, each pinning the
   *   index file; on Windows those leaked handles block the migrator's own rename / dir-delete and
   *   show up as the intermittent "file lock". Manual BEGIN keeps every statement on the single
   *   connection, so close() releases all of it deterministically — no orphans, no leaked handles.
   *
   *   Only safe when this driver has NO concurrent readers: a read via execute() runs outside the
   *   write mutex, and on the single connection it would execute inside an open manual transaction
   *   (seeing uncommitted writes, losing WAL read isolation). The runtime index store depends on
   *   concurrent reads (listExistingEmbeddingHashes runs outside the base lock), so it keeps the
   *   default (false); only the boot-time migration — sole writer, no readers — opts in.
   */
  constructor(
    private readonly client: Client,
    private readonly serializedSingleConnection = false
  ) {}

  async execute(sql: string, args: SqlValue[] = []): Promise<SqlQueryResult> {
    this.assertOpen()
    return toQueryResult(await this.client.execute({ sql, args: args as InValue[] }))
  }

  async transaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    this.assertOpen()
    return this.writeMutex.runExclusive(async () => {
      // Re-check after acquiring: the driver may have been closed while queued.
      this.assertOpen()
      return this.serializedSingleConnection ? this.runManualTransaction(fn) : this.runClientTransaction(fn)
    })
  }

  /** Default: a libsql interactive transaction on its own (orphaned-on-commit) connection. */
  private async runClientTransaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction('write')
    try {
      const handle: SqliteTransaction = {
        execute: async (sql, args = []) => toQueryResult(await tx.execute({ sql, args: args as InValue[] }))
      }
      const result = await fn(handle)
      await tx.commit()
      return result
    } catch (error) {
      // Roll back, but never let a rollback failure mask the original error that
      // triggered it — that original is what callers need to diagnose the write.
      try {
        await tx.rollback()
      } catch (rollbackError) {
        logger.warn('Failed to roll back knowledge index store transaction after an error', rollbackError as Error)
      }
      throw error
    }
  }

  /** Opt-in: manual BEGIN/COMMIT/ROLLBACK on the single connection — no orphaned handles. */
  private async runManualTransaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    const handle: SqliteTransaction = {
      execute: async (sql, args = []) => toQueryResult(await this.client.execute({ sql, args: args as InValue[] }))
    }
    // BEGIN IMMEDIATE acquires the write lock up front (matching client.transaction('write')), so a
    // read-then-write transaction never fails mid-way after the read already ran.
    await this.client.execute('BEGIN IMMEDIATE')
    try {
      const result = await fn(handle)
      await this.client.execute('COMMIT')
      return result
    } catch (error) {
      try {
        await this.client.execute('ROLLBACK')
      } catch (rollbackError) {
        logger.warn('Failed to roll back knowledge index store transaction after an error', rollbackError as Error)
      }
      throw error
    }
  }

  async reclaim(): Promise<SqliteReclaimOutcome> {
    this.assertOpen()
    // Hold the write mutex so VACUUM never overlaps one of this driver's write
    // transactions on the same connection (reads run outside it and ride the WAL /
    // busy_timeout). runExclusive only serializes — it issues no BEGIN, so VACUUM,
    // which cannot run inside a transaction, executes in autocommit as required.
    return this.writeMutex.runExclusive(async () => {
      this.assertOpen()
      // Checkpoint first: frees the WAL (cheap) and folds committed frees from the
      // delete into the main file so freelist_count reflects them.
      await this.client.execute('PRAGMA wal_checkpoint(TRUNCATE)')

      const pageSize = await this.readPragmaInt('page_size')
      const pageCount = await this.readPragmaInt('page_count')
      const freelist = await this.readPragmaInt('freelist_count')
      const ratio = pageCount > 0 ? freelist / pageCount : 0
      if (ratio < VACUUM_MIN_FREELIST_RATIO || freelist * pageSize < VACUUM_MIN_FREED_BYTES) {
        return { vacuumed: false, reclaimedBytes: 0 }
      }

      // Compact the external-content FTS before the VACUUM. A delete only TOMBSTONES its
      // trigram entries (via the search_text delete trigger); the segment blobs linger as
      // live rows in the search_text_fts_data shadow table, which VACUUM cannot reclaim
      // (they are not free pages). 'optimize' merges and drops them, returning their pages
      // to the freelist so the VACUUM below hands them back to the OS — without it a
      // whole-folder delete leaves the FTS index nearly as large as before.
      await this.client.execute(`INSERT INTO search_text_fts(search_text_fts) VALUES('optimize')`)
      await this.client.execute('PRAGMA wal_checkpoint(TRUNCATE)')

      // VACUUM rewrites the whole file and renumbers every table's implicit rowid — but
      // search_text_fts keys on search_text.fts_rowid (a real integer column copied verbatim
      // through the rewrite), NOT the implicit rowid, so the external-content index stays
      // aligned by construction (see schema.ts; this is exactly the #16132 desync class that
      // keying on the implicit rowid would reintroduce). VACUUM rewrites into the WAL, so
      // checkpoint+truncate again to release it.
      await this.client.execute('VACUUM')
      await this.client.execute('PRAGMA wal_checkpoint(TRUNCATE)')
      const pageCountAfter = await this.readPragmaInt('page_count')
      return { vacuumed: true, reclaimedBytes: Math.max(0, pageCount - pageCountAfter) * pageSize }
    })
  }

  /** Read a single-value PRAGMA (e.g. `page_count`) as a number. */
  private async readPragmaInt(pragma: string): Promise<number> {
    const result = toQueryResult(await this.client.execute(`PRAGMA ${pragma}`))
    const row = result.rows[0]
    return row ? Number(Object.values(row)[0] ?? 0) : 0
  }

  isClosed(): boolean {
    return this.closed
  }

  /** Idempotent: a second close() (e.g. shutdown after an explicit deleteStore) is a no-op. */
  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    this.client.close()
  }

  /** Fail use-after-close with a deterministic error instead of an opaque libsql one. */
  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Knowledge index store driver is closed')
    }
  }
}

/**
 * Open a per-base index database driver at `filePath`. Configures the connection
 * PRAGMAs: foreign keys (so the schema's ON DELETE CASCADE / SET NULL fire), WAL
 * journal mode + a busy timeout (so reads outside the write mutex don't hit
 * SQLITE_BUSY against a concurrent write), and synchronous = NORMAL (WAL's safe
 * pairing). Mirrors the main DbService PRAGMA setup.
 */
export async function openLibsqlIndexDriver(
  filePath: string,
  options: { serializedSingleConnection?: boolean } = {}
): Promise<LibsqlDriver> {
  const client = createClient({ url: pathToFileURL(filePath).toString() })
  try {
    // Per-connection PRAGMAs via the patched setPragma() so they replay onto every
    // fresh connection @libsql/client opens after a transaction() — a bare
    // `execute('PRAGMA foreign_keys = ON')` would only cover the first connection.
    // The write mutex serializes writes within this driver, but reads run outside
    // it: WAL lets a read (e.g. listExistingEmbeddingHashes mid-rebuild) proceed
    // concurrently with a write instead of hitting SQLITE_BUSY, and busy_timeout
    // makes the remaining contention windows wait rather than fail.
    client.setPragma('PRAGMA busy_timeout = 5000')
    client.setPragma('PRAGMA synchronous = NORMAL')
    client.setPragma('PRAGMA foreign_keys = ON')
    // WAL is persisted in the database file — run once. This also opens the first
    // connection, replaying the per-connection PRAGMAs above onto it.
    await client.execute('PRAGMA journal_mode = WAL')
  } catch (error) {
    // Close the just-opened client so a failed open never leaks the file handle
    // (on Windows a leaked handle would later block deleting the base directory).
    client.close()
    throw error
  }
  return new LibsqlDriver(client, options.serializedSingleConnection ?? false)
}
