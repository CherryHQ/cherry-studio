import { readRestoreJournalFormatVersion } from '@data/db/restore/restoreJournalV2'
import {
  clearConvergedV1Restore,
  isLiveDbStranded as isLiveDbStrandedV1,
  isRestoreRecoveryPending as isRestoreRecoveryPendingV1,
  markRestoreFailedAfterCrash as markRestoreFailedAfterCrashV1,
  runRestorePromotion as runRestorePromotionV1
} from '@data/db/restore/restorePromotionV1Compat'
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
 * No return value on a coherent outcome: promotion success means the new DB is
 * live, and a safely reverted failure means the old DB is. An
 * unexpected crash of the promotion logic is logged and handed to
 * markRestoreFailedAfterCrashV2, which restores the live DB from the aside if
 * needed and freezes the journal to failed (or leaves a committed promotion
 * resumable) so the next boot does not retry a promotion that just proved
 * itself poisonous.
 *
 * This shell normally does not throw — a preboot exception falls into
 * startApp's fail-fast catch (forceExit). It refuses to boot whenever recovery
 * cannot prove a coherent live state: a corrupt/future journal, a stranded DB,
 * or any forward/reverse direction that has not converged. The journal and its
 * staging evidence are preserved rather than guessed away.
 */
export async function runBackupRestoreGate(): Promise<void> {
  if (readRestoreJournalFormatVersion() === 1) {
    try {
      await runRestorePromotionV1()
      clearConvergedV1Restore()
    } catch (error) {
      logger.error('v1 restore upgrade recovery crashed — attempting its last-resort recovery', error as Error)
      try {
        markRestoreFailedAfterCrashV1()
        clearConvergedV1Restore()
      } catch (journalError) {
        logger.error('Failed to converge the v1 restore journal', journalError as Error)
      }
      if (isLiveDbStrandedV1()) {
        throw new Error(
          'Restore recovery failed: the live database is missing while the previous database is still parked aside — refusing to boot into an empty database'
        )
      }
      if (isRestoreRecoveryPendingV1()) {
        throw new Error('v1 restore recovery is incomplete — refusing to boot into a mixed restore state')
      }
    }
    return
  }

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
