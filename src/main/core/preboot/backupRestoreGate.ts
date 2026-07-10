import { markRestoreFailedAfterCrash, runRestorePromotion } from '@data/db/restore/restorePromotion'
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
 * No return value: whatever happens, boot continues — promotion success means
 * the new DB is live, any refusal or failure means the old DB is. This shell
 * NEVER throws: a preboot exception would fall into startApp's fail-fast
 * catch (forceExit) and dead-loop the app into "Unable to Start". An
 * unexpected crash of the promotion logic is logged and handed to
 * markRestoreFailedAfterCrash, which restores the live DB from the aside if
 * needed and freezes the journal to failed so the next boot does not retry a
 * promotion that just proved itself poisonous.
 */
export async function runBackupRestoreGate(): Promise<void> {
  try {
    await runRestorePromotion()
  } catch (error) {
    logger.error('Restore promotion crashed unexpectedly — continuing boot on the current database', error as Error)
    try {
      markRestoreFailedAfterCrash()
    } catch (journalError) {
      logger.error('Failed to mark the restore journal as failed', journalError as Error)
    }
  }
}
