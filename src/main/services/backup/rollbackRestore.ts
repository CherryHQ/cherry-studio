import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { readRestoreJournal, writeRestoreJournal } from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'

const logger = loggerService.withContext('backupRollbackRestore')

/** Arms a database-only rollback and enters the zero-connection preboot gate. */
export function armRestoreRollback(): void {
  const read = readRestoreJournal()
  if (read.kind !== 'ok' || read.journal.state !== 'completed') {
    throw new Error('no completed restore is available to roll back')
  }
  const journal = read.journal
  const asidePath = path.resolve(application.getPath('app.userdata'), journal.db.aside)
  const aside = fs.existsSync(asidePath) ? fs.lstatSync(asidePath) : null
  if (!aside?.isFile() || aside.isSymbolicLink()) {
    throw new Error('the data from before this restore has already been released or changed and cannot be rolled back')
  }

  writeRestoreJournal({ ...journal, state: 'rollback-armed' })
  try {
    application.relaunch()
  } catch (error) {
    writeRestoreJournal(journal)
    logger.error('Rollback relaunch failed; the completed restore was left unchanged', error as Error)
    throw error
  }
}
