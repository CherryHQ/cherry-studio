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
 * Boot continues after a promotion or recoverable failure — promotion success means
 * the new DB is live, any refusal or failure means the old DB is. An
 * unexpected crash of the promotion logic is logged and handed to
 * markRestoreFailedAfterCrash, which restores the live DB from the aside if
 * needed and freezes the journal to failed (or leaves a committed promotion
 * resumable) so the next boot does not retry a promotion that just proved
 * itself poisonous.
 *
 * An unreadable/invalid journal or a stranded live DB refuses boot. Without
 * a trustworthy journal, recovery cannot decide which copies are safe to
 * consume; keep the canonical journal and staging tree for a later retry.
 */
export async function runBackupRestoreGate(): Promise<void> {
  let journalUnavailable = false
  try {
    journalUnavailable = (await runRestorePromotion()) === 'journal-unavailable'
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
  if (journalUnavailable) {
    throw new Error('Restore journal cannot be read or validated — refusing to boot; recovery artifacts are preserved')
  }
  cleanupTerminalRestoreArtifacts()
}
