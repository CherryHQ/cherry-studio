import {
  isLiveDbStranded,
  isRestoreRecoveryPending,
  markRestoreFailedAfterCrash,
  runRestorePromotion
} from '@data/db/restore/restorePromotion'
import { loggerService } from '@logger'

const logger = loggerService.withContext('BackupRestoreGate')

/**
 * Executes the database-only restore transaction in the zero-connection preboot
 * window. Unknown journals are evidence, not input: promotion leaves them in
 * place and this shell refuses a boot that could expose an empty or mixed DB.
 */
export async function runBackupRestoreGate(): Promise<void> {
  try {
    await runRestorePromotion()
  } catch (error) {
    logger.error('Restore promotion crashed unexpectedly — attempting last-resort recovery', error as Error)
    try {
      markRestoreFailedAfterCrash()
    } catch (recoveryError) {
      logger.error('Failed to converge restore recovery', recoveryError as Error)
    }
    if (isLiveDbStranded()) {
      throw new Error(
        'Restore recovery failed: the live database is missing while the previous database is still parked aside — refusing to boot into an empty database'
      )
    }
    if (isRestoreRecoveryPending()) {
      throw new Error('Restore recovery is incomplete — refusing to boot into a mixed restore state')
    }
  }
}
