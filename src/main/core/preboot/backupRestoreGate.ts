import { isLiveDbStranded, markRestoreFailedAfterCrash, runRestorePromotion } from '@data/db/restore/restorePromotion'
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
 * the new DB is live, any refusal or failure means the old DB is. An
 * unexpected crash of the promotion logic is logged and handed to
 * markRestoreFailedAfterCrash, which restores the live DB from the aside if
 * needed and freezes the journal to failed (or leaves a committed promotion
 * resumable) so the next boot does not retry a promotion that just proved
 * itself poisonous.
 *
 * This shell never throws — a preboot exception falls into startApp's
 * fail-fast catch (forceExit) and dead-loops the app into "Unable to Start" —
 * with exactly ONE exception: when even the crash net could not put a live
 * DB in place (isLiveDbStranded), booting on would silently CREATE a fresh
 * empty database while the user's data sits in the aside. That is the one
 * outcome worse than the fail-fast dialog, so the gate refuses to boot and
 * leaves the aside, the journal, and the staging tree as repair artifacts.
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
}
