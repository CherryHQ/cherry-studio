import { application } from '@application'
import { loggerService } from '@logger'

import { RestoreStateError } from './errors'

const logger = loggerService.withContext('backup/restoreTransitionFailure')

/**
 * The journal already authorizes preboot work. Prefer a normal relaunch; if
 * Electron cannot schedule one, force this process to exit so preboot remains
 * the sole recovery owner.
 */
export async function exitForRestoreJournalRecovery(cause: unknown): Promise<never> {
  logger.error('Restore journal transition could not be rolled back; exiting for preboot recovery', {
    cause: cause instanceof Error ? cause.message : String(cause)
  })
  try {
    application.relaunch()
  } catch (relaunchError) {
    logger.error('Could not schedule restore recovery relaunch; forcing exit', relaunchError as Error)
    try {
      application.forceExit(1)
    } catch (exitError) {
      logger.error('Could not force restore recovery exit', exitError as Error)
    }
  }
  throw new RestoreStateError('relaunch-failed', 'restore recovery requires an application restart')
}
