import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { clearRestoreJournal, readRestoreJournal } from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'

const logger = loggerService.withContext('backupAcknowledgeRestore')

export interface AcknowledgeResult {
  readonly acknowledged: boolean
  readonly restoreId?: string
  readonly removed: number
}

function rejectedDbPath(restoreId: string): string {
  const livePath = application.getPath('app.database.file')
  return path.join(path.dirname(livePath), `${path.basename(livePath)}.restore-rejected-${restoreId}`)
}

function removeOwnedRegularFile(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0
  const stats = fs.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('restore recovery artifact was replaced; refusing to remove it')
  }
  fs.unlinkSync(filePath)
  return 1
}

function assertAbsent(filePath: string): void {
  if (fs.existsSync(filePath)) throw new Error('restore recovery artifacts do not match the terminal state')
}

/**
 * Releases only the owned artifact shape proved by each terminal state, then
 * clears the journal last. Active and unreadable journals remain evidence.
 */
export function acknowledgeRestore(): AcknowledgeResult {
  const read = readRestoreJournal()
  if (read.kind === 'none') return { acknowledged: false, removed: 0 }
  if (read.kind !== 'ok') throw new Error('restore journal is unreadable and requires explicit repair')
  const journal = read.journal
  if (!['completed', 'rolled-back', 'failed', 'expired'].includes(journal.state)) {
    throw new Error(`a restore in state '${journal.state}' cannot be acknowledged`)
  }

  const userData = application.getPath('app.userdata')
  const asidePath = path.resolve(userData, journal.db.aside)
  const rejectedPath = rejectedDbPath(journal.restoreId)
  let removed = 0

  switch (journal.state) {
    case 'completed':
      // The restored DB is live and the old DB remains only as the rollback source.
      assertAbsent(rejectedPath)
      removed += removeOwnedRegularFile(asidePath)
      break
    case 'rolled-back':
    case 'failed':
      // The old DB is live; a rollback/revert may retain only the displaced new DB.
      assertAbsent(asidePath)
      removed += removeOwnedRegularFile(rejectedPath)
      break
    case 'expired':
      // No mutation began, so no DB artifact is safe to reclaim by inference.
      assertAbsent(asidePath)
      assertAbsent(rejectedPath)
      break
  }

  clearRestoreJournal()
  logger.info('Restore acknowledged', { restoreId: journal.restoreId, state: journal.state, removed })
  return { acknowledged: true, restoreId: journal.restoreId, removed }
}
