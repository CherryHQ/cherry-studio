import { application } from '@application'
import { loggerService } from '@logger'
import { app } from 'electron'

const logger = loggerService.withContext('SingleInstance')

/**
 * Require this process to be the primary Cherry Studio instance.
 *
 * Claims Electron's single-instance lock via `app.requestSingleInstanceLock()`.
 * If another Cherry Studio process already holds the lock, this function
 * logs the outcome, calls `application.quit()` to let the shared quit
 * machinery run, and then calls `process.exit(0)` as a belt-and-suspenders
 * terminator in case the Electron `quit` path is slow or blocked. Callers
 * can therefore treat a normal return from this function as a guarantee
 * that we are the live process.
 *
 * Timing contract:
 *   - Must run as the very first preboot step, before
 *     `resolveUserDataLocation()`. That ordering prevents a second
 *     instance from entering `executePendingRelocation()` and issuing
 *     an expensive `fs.cpSync` against the userData directory tree,
 *     and removes the race window where two processes could both try
 *     to execute a pending `temp.user_data_relocation` at the same time.
 *   - Must run before `application.initPathRegistry()` so second
 *     instances exit before wasting work on a frozen path snapshot.
 *   - Does not depend on any lifecycle-managed service: `application.quit()`
 *     is the container's own top-level method, identical in spirit to
 *     how v2MigrationGate uses it on its fatal branches.
 *
 * See core/preboot/README.md for the preboot membership criteria.
 *
 * **Development:** Uses the same exclusive lock as production so
 * `cherrystudio://` OAuth callbacks on Windows/Linux forward to the running
 * process via `second-instance` instead of spawning a second Electron.
 * To run a second dev instance against the same user data (e.g. parallel
 * debugging), set env `CHERRY_STUDIO_ALLOW_SECOND_DEV_INSTANCE=1`; OAuth
 * deep links will then start a separate process again.
 */
export function requireSingleInstance(): void {
  if (!app.isPackaged && process.env.CHERRY_STUDIO_ALLOW_SECOND_DEV_INSTANCE === '1') {
    return
  }

  if (app.requestSingleInstanceLock()) return

  logger.info('Another Cherry Studio instance already holds the single-instance lock; exiting')
  application.quit()
  process.exit(0)
}
