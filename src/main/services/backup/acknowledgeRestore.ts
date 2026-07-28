/**
 * Acknowledgement — the commit-to-keep action that ends a restore
 * (docs/references/backup/README.md §6.5).
 *
 * Between a completed promotion and this call the restore still owns storage:
 * the replaced database sits in its aside, the orphan sweep stands aside, and a
 * rollback is still physically possible. Acknowledgement is the user saying the
 * restored state is the one they want, so it releases all of that.
 *
 * ORDER IS THE CONTRACT: asides first, journal LAST. The journal is what holds
 * GC protection, so clearing it before the asides would leave unprotected files
 * on disk for the sweep to reason about. Every step is idempotent, which is what
 * makes a crash anywhere in the middle resumable by simply calling this again —
 * protection stays on until the final unlink.
 *
 * This is crash-rollback protection, not a hidden long-term undo: once
 * acknowledged, the previous database is gone.
 */

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { clearRestoreJournalV2, readRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'

import { RestoreStateError } from './errors'

const logger = loggerService.withContext('backupAcknowledgeRestore')

/** What the acknowledgement removed, for the caller to report. */
export interface AcknowledgeResult {
  /** False when there was nothing to acknowledge (already done, or no restore ran). */
  readonly acknowledged: boolean
  readonly restoreId?: string
  /** Recovery artifacts actually unlinked. */
  readonly removed: number
}

export function acknowledgeRestore(): AcknowledgeResult {
  const read = readRestoreJournalV2()
  if (read.kind === 'none') {
    return { acknowledged: false, removed: 0 }
  }
  if (read.kind === 'corrupt') {
    // Nothing can be proven about which asides it owns, so deleting from it
    // would be guesswork. The next boot's promotion gate quarantines it.
    throw new RestoreStateError('unreadable', 'the restore journal is unreadable; the next boot will quarantine it')
  }

  const journal = read.journal
  if (journal.state === 'prepared' || journal.state === 'armed' || journal.state === 'promoting') {
    // Acknowledging a restore that has not finished would release GC protection
    // over a database the promotion is still about to move.
    throw new RestoreStateError(
      'wrong-state',
      `a restore in state '${journal.state}' has not finished and cannot be acknowledged`
    )
  }

  if (journal.state === 'completed' && journal.resourcesIncomplete) {
    // A unit that never reached its installed slot has its new copy in the
    // staging tree and its old one in the aside — the two things this function
    // deletes. Releasing them would leave that unit with neither. The next boot
    // retries the install and clears the marker.
    throw new RestoreStateError(
      'recovery-incomplete',
      'the last restore could not put every file in place; restart the app to finish it before releasing anything'
    )
  }

  if (journal.state === 'failed' && journal.recoveryIncomplete) {
    // The rollback did not finish, so these asides are not spent rollback
    // material — they are the only copy of what they hold. Acknowledging would
    // delete exactly what the repair needs. The next boot retries the rollback
    // and clears the marker, which is what makes this refusal temporary.
    throw new RestoreStateError(
      'recovery-incomplete',
      'the last restore could not put every file back; restart the app to finish it before releasing anything'
    )
  }

  const userData = application.getPath('app.userdata')
  const artifacts = [
    journal.db.aside,
    ...journal.resourceInstalls.map((entry) => entry.aside),
    // The database a post-commit revert parked for forensics. Nothing else
    // knows its restoreId, so nothing else could ever clean it up.
    `restore-failed-${journal.restoreId}.sqlite`,
    // Normally already gone — the promotion drops it on its way to a terminal
    // state. It survives only when a crash landed between the terminal journal
    // write and that removal, and this is the last step that still knows which
    // tree belonged to this restore.
    `${path.basename(application.getPath('feature.backup.restore.staging'))}/${journal.restoreId}`
  ]

  let removed = 0
  for (const relative of artifacts) {
    const target = path.resolve(userData, relative)
    if (!fs.existsSync(target)) continue
    fs.rmSync(target, { recursive: true, force: true })
    removed++
  }

  clearRestoreJournalV2()
  logger.info('Restore acknowledged', { restoreId: journal.restoreId, state: journal.state, removed })
  return { acknowledged: true, restoreId: journal.restoreId, removed }
}
