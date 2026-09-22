import { app, session } from 'electron'

import { loggerService } from '@logger'

import type { RestoreJournal } from './restoreJournal'

const logger = loggerService.withContext('RestorePromotion')

/** userData-relative directory names Chromium keeps open via LevelDB on Windows. */
export const CHROMIUM_RUNTIME_DIR_NAMES = ['IndexedDB', 'Local Storage'] as const

type ChromiumRuntimeDirName = (typeof CHROMIUM_RUNTIME_DIR_NAMES)[number]

type FileResource = RestoreJournal['fileResources'][number]

export function isChromiumRuntimeDir(livePath: string): livePath is ChromiumRuntimeDirName {
  return CHROMIUM_RUNTIME_DIR_NAMES.includes(livePath as ChromiumRuntimeDirName)
}

export function entryNeedsChromiumStorageQuiesce(entry: FileResource): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  return (entry.kind === 'overwrite' || entry.kind === 'note-overwrite') && isChromiumRuntimeDir(entry.livePath)
}

function clearDataTypesForDir(livePath: ChromiumRuntimeDirName): Array<'indexedDB' | 'localStorage'> {
  if (livePath === 'Local Storage') {
    return ['localStorage']
  }
  return ['indexedDB']
}

/**
 * Release Chromium LevelDB handles on the default session after the live
 * directory has been parked aside, so the staging copy can land at the live path.
 *
 * Uses `clearData` rather than `clearStorageData` because the pinned Electron
 * version does not reliably release IndexedDB handles via the legacy API.
 */
export async function quiesceChromiumStorageForRestore(livePath: ChromiumRuntimeDirName): Promise<void> {
  await app.whenReady()
  await session.defaultSession.clearData({
    dataTypes: clearDataTypesForDir(livePath)
  })
  logger.info('Chromium runtime storage quiesced for restore promotion', { livePath })
}
