import { drizzle } from 'drizzle-orm/better-sqlite3'

import { Database, getSqlite, loadSqlite, SqliteError } from '@cherrystudio/sqlite-wasm-compat'
import { applyMigrations } from '@data/db/applyMigrations'
import { registerKnowledgeFunctions } from '@data/db/knowledgeFunctions'
import type { DbType } from '@data/db/types'

import { acquireAccountLock } from './accountLock'
import { WebDbService } from './WebDbService'

export interface OpenDatabaseOptions {
  /** How long to wait for a previous Worker of this account to release its lock and file handles. */
  handoverTimeoutMs?: number
}

export interface OpenedDatabase {
  service: WebDbService
  path: string
  openMs: number
  migrateMs: number
  close(): void
}

const OPFS_VFS = 'opfs'
// A Worker torn down by a reload releases its OPFS access handles late; opening during
// that window fails with one of these codes instead of waiting.
const HANDOVER_CODES = /^SQLITE_(BUSY|LOCKED|CANTOPEN|IOERR)/

export function databasePath(account: string): string {
  return `/cherry-studio/${encodeURIComponent(account)}/cherry-studio.sqlite`
}

/** Removes the account's database and files from OPFS; fails while another Worker has the account open. */
export async function deleteAccountData(account: string, handoverTimeoutMs = 3000): Promise<void> {
  const release = await acquireAccountLock(account, handoverTimeoutMs)
  try {
    const root = await navigator.storage.getDirectory()
    const accounts = await root.getDirectoryHandle('cherry-studio', { create: true })
    await accounts.removeEntry(encodeURIComponent(account), { recursive: true })
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  } finally {
    release()
  }
}

/**
 * Opens the account's database on the non-pooled `opfs` VFS and migrates it.
 * The pooled `opfs-sahpool` VFS is not used: a Worker killed mid-write
 * (page reload) corrupted it, while `opfs` rolled back cleanly. `opfs` requires
 * a cross-origin-isolated page (COOP `same-origin` + COEP `require-corp`).
 */
export async function openDatabase(account: string, options: OpenDatabaseOptions = {}): Promise<OpenedDatabase> {
  const handoverTimeoutMs = options.handoverTimeoutMs ?? 3000
  const started = performance.now()
  const release = await acquireAccountLock(account, handoverTimeoutMs)
  try {
    if (typeof FileSystemFileHandle === 'undefined' || !('createSyncAccessHandle' in FileSystemFileHandle.prototype)) {
      throw Object.assign(new Error('The browser has no synchronous OPFS access handles'), {
        name: 'BrowserUnsupportedError'
      })
    }
    await loadSqlite()
    if (!getSqlite().capi.sqlite3_vfs_find(OPFS_VFS)) {
      throw new Error('The OPFS VFS is unavailable: the page must be cross-origin isolated (COOP + COEP)')
    }
    const path = databasePath(account)
    const sqlite = await openWithRetry(path, started + handoverTimeoutMs)
    registerKnowledgeFunctions(sqlite as never)
    const db = drizzle({ client: sqlite as never, casing: 'snake_case' }) as DbType
    const openMs = performance.now() - started

    // The migration folder argument is ignored: the Worker build bundles the migrations.
    applyMigrations(db, 'bundled')
    const migrateMs = performance.now() - started - openMs

    return {
      service: new WebDbService(sqlite, db),
      path,
      openMs,
      migrateMs,
      close() {
        sqlite.close()
        release()
      }
    }
  } catch (error) {
    release()
    throw error
  }
}

async function openWithRetry(path: string, deadline: number): Promise<Database> {
  for (let attempt = 1; ; attempt++) {
    let sqlite: Database | undefined
    try {
      sqlite = new Database(path, { vfs: OPFS_VFS })
      // Touch the file so a handle still held by the previous Worker surfaces here.
      sqlite.pragma('schema_version')
      return sqlite
    } catch (error) {
      sqlite?.close()
      const retryable = error instanceof SqliteError && HANDOVER_CODES.test(error.code)
      if (!retryable || performance.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * attempt, 500)))
    }
  }
}
