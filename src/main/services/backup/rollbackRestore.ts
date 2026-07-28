import fs from 'node:fs'

import { application } from '@application'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'

import { RestoreStateError } from './errors'

const logger = loggerService.withContext('backupRollbackRestore')

/**
 * Arm an explicit rollback of a completed restore and relaunch into the
 * zero-connection preboot gate. The completed journal already owns the previous
 * database and every replaced resource aside; this transition grants the gate
 * permission to move those originals back into their live slots.
 *
 * If relaunch initiation fails, restore the completed journal. Leaving a
 * rollback intent behind after telling the user the request failed would make an
 * unrelated later restart discard the restored state without fresh consent.
 */
export function armRestoreRollback(): void {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok') {
    throw new RestoreStateError(
      read.kind === 'corrupt' ? 'unreadable' : 'wrong-state',
      'no completed restore is available to roll back'
    )
  }

  const journal = read.journal
  if (journal.state !== 'completed') {
    throw new RestoreStateError('wrong-state', `only a completed restore can be rolled back (state: ${journal.state})`)
  }
  if (journal.resourcesIncomplete) {
    throw new RestoreStateError(
      'recovery-incomplete',
      'the restore must finish installing every file before it can be rolled back'
    )
  }
  // Acknowledgement removes the DB aside first and the journal last. A power
  // loss between those steps can therefore leave a completed journal whose
  // rollback source is already gone; never arm that irrecoverable direction.
  const asidePath = application.getPath('app.userdata', journal.db.aside)
  const asideStats = fs.existsSync(asidePath) ? fs.lstatSync(asidePath) : null
  if (!asideStats?.isFile() || asideStats.isSymbolicLink()) {
    throw new RestoreStateError(
      'rollback-unavailable',
      'the data from before this restore has already been released or changed and cannot be rolled back'
    )
  }

  const armed = { ...journal, state: 'rollback-armed' as const }
  writeRestoreJournalV2(armed)
  try {
    application.relaunch()
  } catch (error) {
    writeRestoreJournalV2(journal)
    logger.error('Rollback relaunch failed; the completed restore was left unchanged', error as Error)
    throw new RestoreStateError('relaunch-failed', 'failed to relaunch for restore rollback')
  }
  logger.info('Restore rollback armed; relaunching', {
    restoreId: journal.restoreId
  })
}
