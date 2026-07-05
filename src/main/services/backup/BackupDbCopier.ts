// BackupDbCopier — injectable port that isolates the "copy live DB to a backup
// file" mechanism from the ExportOrchestrator.
//
// Per export-orchestrator.md "createBackupCopy": export uses better-sqlite3
// `db.backup()` (sqlite's ONLINE backup API — page-by-page, safe under
// concurrent writes, no write-quiesce needed), NOT createSnapshot (VACUUM INTO,
// which is restore-merge-base only). fullex #16714 floated `backupTo(path)` via
// `db.backup()` for export.
//
// DbService.sqlite is private (DbService.ts L40), so the interim impl opens a
// 2nd better-sqlite3 connection to the live file (sqlite allows multi-connection
// to the same file; the backup API is designed for online backup). When fullex
// lands `DbService.backupTo(path)` upstream, the orchestrator swaps in a thin
// adapter behind this same port — zero churn for callers.

import { copyFile, unlink } from 'node:fs/promises'

import Database from 'better-sqlite3'

/** Injectable copy port. The orchestrator takes one of these in its constructor. */
export interface BackupDbCopier {
  copyTo(destPath: string): Promise<void>
}

/**
 * Interim impl (option A): 2nd better-sqlite3 connection to the live DB file →
 * online `db.backup(dest)`. No upstream dependency. The source connection stays
 * owned by DbService; this class never touches it.
 */
export class SqliteBackupCopier implements BackupDbCopier {
  constructor(private readonly liveDbPath: string) {}

  async copyTo(destPath: string): Promise<void> {
    // Ensure a fresh destination: sqlite's online backup CAN overwrite an
    // existing same-format file, but a stale/different-format target can make
    // sqlite3_backup_init refuse (SQLITE_CORRUPT/READONLY). The orchestrator
    // already uses unique restoreId paths, so this unlink is defensive — it
    // guarantees a clean target even after a crashed prior run.
    await unlink(destPath).catch(() => {})

    // Open a separate connection to the live file. `fileMustExist` — the live DB
    // must already exist (it does once DbService.onInit has run).
    const src = new Database(this.liveDbPath, { fileMustExist: true })
    try {
      // Online backup: sqlite copies pages from src to dest, retrying pages that
      // change mid-copy. Handles WAL + concurrent writers without write-quiesce.
      // Returns a Promise that resolves once the snapshot is fully written.
      await src.backup(destPath)
    } finally {
      src.close()
    }
  }
}

/**
 * Test double — copies a pre-staged fixture file to dest (no live DB needed).
 * Used by ExportOrchestrator unit tests to avoid the real DB in copy-step coverage.
 */
export class StubBackupCopier implements BackupDbCopier {
  constructor(private readonly fixturePath: string) {}

  async copyTo(destPath: string): Promise<void> {
    await copyFile(this.fixturePath, destPath)
  }
}
