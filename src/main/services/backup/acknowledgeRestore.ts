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

/**
 * Releases the single rollback snapshot only after a completed outcome is
 * accepted. The journal is removed last; until then GC must preserve asides.
 */
export function acknowledgeRestore(): AcknowledgeResult {
  const read = readRestoreJournal()
  if (read.kind === 'none') return { acknowledged: false, removed: 0 }
  if (read.kind !== 'ok') throw new Error('restore journal is unreadable and requires explicit repair')
  const journal = read.journal
  if (journal.state !== 'completed' && journal.state !== 'rolled-back') {
    throw new Error(`a restore in state '${journal.state}' cannot be acknowledged`)
  }

  const userData = application.getPath('app.userdata')
  const artifacts = [path.resolve(userData, journal.db.aside), rejectedDbPath(journal.restoreId)]
  let removed = 0
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact)) continue
    const stats = fs.lstatSync(artifact)
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error('restore recovery artifact was replaced; refusing to remove it')
    fs.unlinkSync(artifact)
    removed++
  }
  clearRestoreJournal()
  logger.info('Restore acknowledged', { restoreId: journal.restoreId, removed })
  return { acknowledged: true, restoreId: journal.restoreId, removed }
}
