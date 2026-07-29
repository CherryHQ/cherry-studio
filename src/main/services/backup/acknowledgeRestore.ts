/**
 * Acknowledgement — the commit-to-keep action that ends a restore
 * (docs/references/backup/README.md §6.5).
 *
 * Between a completed promotion and this call the restore still owns storage:
 * either the previous state remains available for rollback, or a completed
 * rollback retains the displaced restored state. Acknowledgement commits to the
 * currently live side and releases the other one.
 *
 * ORDER IS THE CONTRACT: asides first, journal LAST. The journal is what holds
 * GC protection, so clearing it before the asides would leave unprotected files
 * on disk for the sweep to reason about. Every step is idempotent, which is what
 * makes a crash anywhere in the middle resumable by simply calling this again —
 * protection stays on until the final unlink.
 *
 * This is one bounded undo, not history: once either result is acknowledged,
 * its displaced database and resources are gone.
 */

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { findUnsafeAncestor } from '@data/db/restore/pathSafety'
import {
  clearRestoreJournalV2,
  dbAsideRelPathV2,
  readRestoreJournalV2,
  writeRestoreJournalV2
} from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'

import { RestoreStateError } from './errors'
import { resourceAsideRoot } from './resources/planInstalls'

const logger = loggerService.withContext('backupAcknowledgeRestore')

export interface AbandonedKnowledgeRebuild {
  readonly restoreId: string
  readonly pendingBaseIds: readonly string[]
}

/**
 * Persist the user's decision to keep the restored profile without waiting for
 * every derived Knowledge index. The marker stops future polling across crashes;
 * the service cancels in-memory jobs before acknowledgement releases rollback
 * material.
 */
export function abandonKnowledgeRebuild(): AbandonedKnowledgeRebuild {
  const read = readRestoreJournalV2()
  if (read.kind === 'corrupt') {
    throw new RestoreStateError('unreadable', 'the restore journal is unreadable and requires explicit repair')
  }
  if (read.kind === 'none' || read.journal.state !== 'completed') {
    throw new RestoreStateError('wrong-state', 'only a completed restore can abandon Knowledge rebuilding')
  }

  const journal = read.journal
  const completed = new Set(journal.knowledgeRebuild?.completedBaseIds ?? [])
  const pendingBaseIds = journal.summary.knowledgeBaseIds.filter((id) => !completed.has(id))
  writeRestoreJournalV2({
    ...journal,
    knowledgeRebuild: {
      completedBaseIds: journal.summary.knowledgeBaseIds.filter((id) => completed.has(id)),
      abandoned: true
    }
  })
  return { restoreId: journal.restoreId, pendingBaseIds }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Prove the journal is describing THIS restore's own park slots before anything
 * is deleted.
 *
 * The journal is app-written, but it is also the one input to a recursive
 * delete, and it survives on disk across crashes and app versions. Recomputing
 * both owners from the path registry and the restore id — rather than reading
 * the strings back — is what keeps a hand-edited or stale journal from pointing
 * the cleanup at an arbitrary userData subtree.
 */
function assertRestoreOwnsArtifacts(
  restoreId: string,
  dbAside: string,
  resourceInstalls: readonly { readonly aside: string }[]
): void {
  if (dbAside !== dbAsideRelPathV2(restoreId)) {
    throw new RestoreStateError('unsafe-artifact', 'the restore journal does not describe this device’s park slot')
  }
  const owned = `${resourceAsideRoot(restoreId)}/`
  for (const entry of resourceInstalls) {
    if (!entry.aside.startsWith(owned)) {
      throw new RestoreStateError('unsafe-artifact', 'a recovery artifact does not belong to this restore')
    }
  }
}

/**
 * Prove the path a delete is about to follow, at the moment it is followed.
 *
 * Install and recovery re-prove their ancestors for the same reason; a delete
 * has to as well, and later: acknowledgement can run days after the promotion,
 * long enough for an ancestor to become a symlink pointing anywhere. Refusing
 * leaves the journal — and therefore the retry — in place, so removing the
 * interloper and acknowledging again finishes the job.
 */
function assertReleasable(userData: string, relative: string, stats: fs.Stats): void {
  const unsafe = findUnsafeAncestor(userData, relative)
  if (unsafe !== null) {
    logger.error('Refusing to release a recovery artifact through an unsafe ancestor', { relative, unsafe })
    throw new RestoreStateError('unsafe-artifact', 'a recovery artifact is no longer where this restore left it')
  }
  if (stats.isSymbolicLink() || !(stats.isFile() || stats.isDirectory())) {
    logger.error('Refusing to release a recovery artifact that is no longer a plain file or directory', { relative })
    throw new RestoreStateError('unsafe-artifact', 'a recovery artifact is no longer where this restore left it')
  }
}

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
    // would be guesswork. Preboot preserves it and refuses unsafe startup.
    throw new RestoreStateError('unreadable', 'the restore journal is unreadable and requires explicit repair')
  }

  const journal = read.journal
  if (
    journal.state === 'prepared' ||
    journal.state === 'armed' ||
    journal.state === 'promoting' ||
    journal.state === 'rollback-armed' ||
    journal.state === 'reverting'
  ) {
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

  if (
    journal.state === 'completed' &&
    !journal.knowledgeRebuild?.abandoned &&
    journal.summary.knowledgeBaseIds.some((id) => !journal.knowledgeRebuild?.completedBaseIds.includes(id))
  ) {
    // The journal is also the durable retry marker for derived Knowledge work.
    // Clearing it while a base is pending would turn the next shutdown into a
    // permanent empty/partial index.
    throw new RestoreStateError(
      'wrong-state',
      'the restored knowledge index is still rebuilding; wait for it to finish before releasing recovery data'
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
  assertRestoreOwnsArtifacts(journal.restoreId, journal.db.aside, journal.resourceInstalls)

  let removed = 0
  for (const relative of artifacts) {
    const target = path.resolve(userData, relative)
    const stats = lstatOrNull(target)
    if (stats === null) continue
    assertReleasable(userData, relative, stats)
    fs.rmSync(target, { recursive: true, force: true })
    removed++
  }

  clearRestoreJournalV2()
  logger.info('Restore acknowledged', {
    restoreId: journal.restoreId,
    state: journal.state,
    removed
  })
  return { acknowledged: true, restoreId: journal.restoreId, removed }
}
