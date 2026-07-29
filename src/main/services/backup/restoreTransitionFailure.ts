import { application } from '@application'
import { loggerService } from '@logger'

import { RestoreStateError } from './errors'

const logger = loggerService.withContext('backup/restoreTransitionFailure')

/**
 * The journal may already authorize preboot work, so reopening writers is no
 * longer safe. Prefer a normal relaunch; if Electron cannot schedule one, still
 * shut the lifecycle down before forcing this process to exit. The retained
 * quiescence hold dies with the process and preboot remains the sole recovery
 * owner.
 */
export async function exitForRestoreJournalRecovery(cause: unknown): Promise<never> {
  logger.error('Restore journal transition could not be rolled back; exiting with profile writers quiesced', {
    cause: cause instanceof Error ? cause.message : String(cause)
  })
  try {
    await application.relaunchAfterShutdown()
  } catch (relaunchError) {
    logger.error(
      'Could not schedule restore recovery relaunch; shutting down before forced exit',
      relaunchError as Error
    )
    try {
      await application.shutdown()
    } catch (shutdownError) {
      logger.error('Restore recovery shutdown did not complete cleanly', shutdownError as Error)
    }
    application.forceExit(1)
  }
  throw new RestoreStateError('relaunch-failed', 'restore recovery requires an application restart')
}
