import { pathToFileURL } from 'node:url'

import { type Client, createClient, type InValue, type ResultSet } from '@libsql/client'
import { loggerService } from '@logger'
import { Mutex } from 'async-mutex'

import type { SqliteDriver, SqliteTransaction, SqlQueryResult, SqlValue } from './types'

const logger = loggerService.withContext('LibsqlDriver')

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

  constructor(private readonly client: Client) {}

  async execute(sql: string, args: SqlValue[] = []): Promise<SqlQueryResult> {
    this.assertOpen()
    return toQueryResult(await this.client.execute({ sql, args: args as InValue[] }))
  }

  async transaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    this.assertOpen()
    return this.writeMutex.runExclusive(async () => {
      // Re-check after acquiring: the driver may have been closed while queued.
      this.assertOpen()
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
    })
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
export async function openLibsqlIndexDriver(filePath: string): Promise<LibsqlDriver> {
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
  return new LibsqlDriver(client)
}
