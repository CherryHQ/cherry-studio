import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import {
  cleanupTerminalRestoreArtifacts,
  isLiveDbStranded,
  markRestoreFailedAfterCrash,
  runRestorePromotion
} from '@data/db/restore/restorePromotion'
import { loggerService } from '@logger'

const logger = loggerService.withContext('BackupRestoreGate')

/**
 * Preboot shell around the restore promotion logic (which lives in
 * data/db/restore/restorePromotion.ts — same layering as
 * v2MigrationGate → MigrationEngine).
 *
 * Runs in startApp() before runV2MigrationGate() reads the DB. Hard ordering
 * constraints: after requireSingleInstance() (the promotion does destructive
 * renames and must hold the single-instance lock) and after the path registry
 * is frozen (all journal paths resolve against the final userData).
 *
 * Boot continues after promotion or complete rollback. Unexpected failures
 * invoke the last-resort recovery net. A stranded database or a surviving
 * pending journal blocks boot: services must not write or sweep data while
 * recovery is incomplete. The next launch retries with the retained artifacts.
 */
export async function runBackupRestoreGate(): Promise<void> {
  try {
    await runRestorePromotion()
  } catch (error) {
    logger.error('Restore promotion crashed unexpectedly — attempting last-resort recovery', error as Error)
    try {
      markRestoreFailedAfterCrash()
    } catch (journalError) {
      logger.error('Failed to mark the restore journal as failed', journalError as Error)
    }
    if (isLiveDbStranded()) {
      throw new Error(
        'Restore recovery failed: the live database is missing while the previous database is still parked aside — refusing to boot into an empty database'
      )
    }
  }
  cleanupTerminalRestoreArtifacts()
  if (hasPendingRestore()) {
    throw new Error('Restore recovery is incomplete — refusing to boot while recovery artifacts are still pending')
  }
}
