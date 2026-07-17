// BackupDbCopier — injectable port that isolates the "copy live DB to a backup
// file" mechanism from the ExportOrchestrator.
//
// Export uses better-sqlite3
// `db.backup()` (sqlite's ONLINE backup API — page-by-page, safe under
// concurrent writes, no write-quiesce needed), NOT createSnapshot (VACUUM INTO,
// which is restore-merge-base only). The source connection MUST be DbService's
// managed handle — a second live connection bypasses ownership and can force
// the online backup to restart when the managed connection writes.

import { copyFile } from 'node:fs/promises'

import type { DbService } from '@main/data/db/DbService'

/** Injectable copy port. The orchestrator takes one of these in its constructor. */
export interface BackupDbCopier {
  copyTo(destPath: string): Promise<void>
}

/**
 * Production impl: delegates to `DbService.backupTo` on the managed connection.
 */
export class SqliteBackupCopier implements BackupDbCopier {
  constructor(private readonly db: Pick<DbService, 'backupTo'>) {}

  async copyTo(destPath: string): Promise<void> {
    await this.db.backupTo(destPath)
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
