import fs from 'node:fs'
import path from 'node:path'

import { app, session } from 'electron'

import { loggerService } from '@logger'

import type { RestoreJournal } from './restoreJournal'

const logger = loggerService.withContext('RestorePromotion')

/** userData-relative directory names Chromium keeps open via LevelDB on Windows. */
export const CHROMIUM_RUNTIME_DIR_NAMES = ['IndexedDB', 'Local Storage'] as const

export type ChromiumRuntimeDirName = (typeof CHROMIUM_RUNTIME_DIR_NAMES)[number]

type FileResource = RestoreJournal['fileResources'][number]

const EPHEMERAL_CHROMIUM_STORAGE_NAMES = new Set(['LOCK', 'LOG', 'LOG.old'])

export function isChromiumRuntimeDir(livePath: string): livePath is ChromiumRuntimeDirName {
  return CHROMIUM_RUNTIME_DIR_NAMES.includes(livePath as ChromiumRuntimeDirName)
}

export function entryNeedsChromiumStorageQuiesce(entry: FileResource): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  return (entry.kind === 'overwrite' || entry.kind === 'note-overwrite') && isChromiumRuntimeDir(entry.livePath)
}

/** Single classification for Windows Chromium overwrite entries that need quiesce. */
export function chromiumRuntimeDirForQuiesce(entry: FileResource): ChromiumRuntimeDirName | undefined {
  if (!entryNeedsChromiumStorageQuiesce(entry)) {
    return undefined
  }
  return entry.livePath as ChromiumRuntimeDirName
}

function chromiumStorageDirHasSubstantiveContent(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return false
  }
  return chromiumStorageTreeHasSubstantiveContent(dirPath)
}

function chromiumStorageTreeHasSubstantiveContent(dirPath: string): boolean {
  for (const name of fs.readdirSync(dirPath)) {
    if (EPHEMERAL_CHROMIUM_STORAGE_NAMES.has(name)) {
      continue
    }
    const entryPath = path.join(dirPath, name)
    const stat = fs.statSync(entryPath)
    if (stat.isDirectory()) {
      if (chromiumStorageTreeHasSubstantiveContent(entryPath)) {
        return true
      }
      continue
    }
    return true
  }
  return false
}

/**
 * After a failed quiesce, Chromium may leave an empty or lock-file-only shell
 * at the live path while the quarantine still holds the intact aside copy.
 */
export function quarantinedChromiumLiveMayBeReinstalled(
  live: string,
  quarantined: string,
  livePathRelative: string
): boolean {
  if (!isChromiumRuntimeDir(livePathRelative)) {
    return false
  }
  return (
    fs.existsSync(quarantined) &&
    chromiumStorageDirHasSubstantiveContent(quarantined) &&
    !chromiumStorageDirHasSubstantiveContent(live)
  )
}

function clearDataTypesForDir(livePath: ChromiumRuntimeDirName): Array<'indexedDB' | 'localStorage'> {
  if (livePath === 'Local Storage') {
    return ['localStorage']
  }
  return ['indexedDB']
}

/**
 * Release Chromium LevelDB handles on the default session while the runtime
 * directory still lives at its userData-relative path, after callers have
 * copied (not renamed) the live tree into the aside rollback slot.
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

export interface ChromiumOverwritePromotionDeps {
  copyAsideDurable: (source: string, target: string) => void
  moveIdempotent: (source: string, target: string) => void
  rmLiveWithRetry: (live: string) => void
}

/**
 * Windows Chromium runtime overwrite: copy-aside, quiesce on the live path,
 * remove the live tree, then land staging. Keeps Chromium policy out of the
 * generic promotion engine.
 */
export async function promoteChromiumRuntimeOverwrite(
  restoreId: string,
  livePath: ChromiumRuntimeDirName,
  live: string,
  staging: string,
  aside: string | undefined,
  stagingPending: boolean,
  deps: ChromiumOverwritePromotionDeps
): Promise<void> {
  if (aside && fs.existsSync(live) && !fs.existsSync(aside)) {
    // Copy, do not rename: clearData runs on the live path while Chromium
    // still holds handles there; renaming aside first would risk clearing
    // the rollback tree through those handles.
    deps.copyAsideDurable(live, aside)
  }
  // Quiesce only while the staging move is still pending AND the aside
  // rollback copy exists — clearData destroys live data, so it must never
  // run unbacked. A crash after the move but before its step marker must
  // not re-run quiesce on restored data either.
  if (stagingPending && aside && fs.existsSync(aside)) {
    logger.info('Quiescing Chromium runtime storage before staging move', {
      restoreId,
      livePath
    })
    await quiesceChromiumStorageForRestore(livePath)
    deps.rmLiveWithRetry(live)
  }
  deps.moveIdempotent(staging, live)
}
