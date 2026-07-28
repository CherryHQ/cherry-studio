import {
  isLiveDbStrandedV2,
  isRestoreRecoveryPendingV2,
  markRestoreFailedAfterCrashV2,
  runRestorePromotionV2
} from '@data/db/restore/restorePromotionV2'
import { loggerService } from '@logger'

const logger = loggerService.withContext('BackupRestoreGate')

/**
 * Preboot shell around the restore promotion logic (which lives in
 * data/db/restore/restorePromotionV2.ts — same layering as
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
 * markRestoreFailedAfterCrashV2, which restores the live DB from the aside if
 * needed and freezes the journal to failed (or leaves a committed promotion
 * resumable) so the next boot does not retry a promotion that just proved
 * itself poisonous.
 *
 * This shell normally does not throw — a preboot exception falls into
 * startApp's fail-fast catch (forceExit). It refuses to boot only when recovery
 * cannot prove a coherent live state: either the DB is stranded aside or an
 * explicitly armed rollback has not converged. Booting the latter would expose
 * a mixed old/new DB-resource state and let new writes make recovery ambiguous.
 */
export async function runBackupRestoreGate(): Promise<void> {
  try {
    await runRestorePromotionV2()
  } catch (error) {
    logger.error('Restore promotion crashed unexpectedly — attempting last-resort recovery', error as Error)
    try {
      markRestoreFailedAfterCrashV2()
    } catch (journalError) {
      logger.error('Failed to mark the restore journal as failed', journalError as Error)
    }
    if (isLiveDbStrandedV2()) {
      throw new Error(
        'Restore recovery failed: the live database is missing while the previous database is still parked aside — refusing to boot into an empty database'
      )
    }
    if (isRestoreRecoveryPendingV2()) {
      throw new Error('Restore recovery is incomplete — refusing to boot into a mixed restore state')
    }
  }
}
