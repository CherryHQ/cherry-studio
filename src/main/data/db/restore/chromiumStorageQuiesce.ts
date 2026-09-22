import { app, session } from 'electron'

import { loggerService } from '@logger'

import type { RestoreJournal } from './restoreJournal'

const logger = loggerService.withContext('RestorePromotion')

/** userData-relative directory names Chromium keeps open via LevelDB on Windows. */
export const CHROMIUM_RUNTIME_DIR_NAMES = ['IndexedDB', 'Local Storage'] as const

export function journalNeedsChromiumStorageQuiesce(journal: RestoreJournal): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  return journal.fileResources.some(
    (entry) =>
      (entry.kind === 'overwrite' || entry.kind === 'note-overwrite') &&
      CHROMIUM_RUNTIME_DIR_NAMES.includes(entry.livePath as (typeof CHROMIUM_RUNTIME_DIR_NAMES)[number])
  )
}

/**
 * Release Chromium LevelDB handles on the default session before renaming
 * runtime storage directories during restore promotion on Windows.
 */
export async function quiesceChromiumStorageForRestore(): Promise<void> {
  await app.whenReady()
  await session.defaultSession.clearStorageData({
    storages: ['localstorage', 'indexeddb']
  })
  logger.info('Chromium runtime storage quiesced for restore promotion')
}
