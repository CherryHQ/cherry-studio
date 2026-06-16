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
 *   - Must run after `resolveUserDataLocation()`. Electron scopes the
 *     single-instance lock to the resolved userData path, so dev runs
 *     using different userData suffixes can coexist while same-suffix
 *     runs still exclude each other.
 *   - Must run before `application.initPathRegistry()` so second
 *     instances exit before wasting work on a frozen path snapshot.
 *   - Packaged runs also resolve userData before this lock. That keeps
 *     the lock aligned with the final BootConfig/portable userData path,
 *     so a second packaged instance using the same data directory exits
 *     before migration gate or bootstrap work begins. Trade-off vs. the
 *     previous single-instance-first ordering: the doomed second instance
 *     still runs the full `resolveUserDataLocation()` first, including Step
 *     1's `executePendingRelocation()` `fs.cpSync` over the userData tree.
 *     Two processes could therefore both execute a pending
 *     `temp.user_data_relocation`. Harmless today because nothing writes a
 *     `pending` state yet; gate pending relocation behind this lock when the
 *     pending-writer lands.
 *   - Does not depend on any lifecycle-managed service: `application.quit()`
 *     is the container's own top-level method, identical in spirit to
 *     how v2MigrationGate uses it on its fatal branches.
 *
 * See core/preboot/README.md for the preboot membership criteria.
 */
export function requireSingleInstance(): void {
  if (app.requestSingleInstanceLock()) return

  logger.info('Another Cherry Studio instance already holds the single-instance lock; exiting')
  application.quit()
  process.exit(0)
}
