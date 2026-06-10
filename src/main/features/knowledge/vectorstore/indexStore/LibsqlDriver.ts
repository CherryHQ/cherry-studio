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
  return { rows, rowsAffected: result.rowsAffected }
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
 * Open a per-base index database driver at `filePath`. Enables foreign keys on
 * the connection — set here (outside any transaction, where the pragma would be
 * a no-op) so the schema's ON DELETE CASCADE / SET NULL actions are enforced.
 */
export async function openLibsqlIndexDriver(filePath: string): Promise<LibsqlDriver> {
  const client = createClient({ url: pathToFileURL(filePath).toString() })
  try {
    await client.execute('PRAGMA foreign_keys = ON')
  } catch (error) {
    // Close the just-opened client so a failed open never leaks the file handle
    // (on Windows a leaked handle would later block deleting the base directory).
    client.close()
    throw error
  }
  return new LibsqlDriver(client)
}
