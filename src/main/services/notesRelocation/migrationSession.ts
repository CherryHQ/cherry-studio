import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/core/platform'
import type { WindowId } from '@shared/ipc/types'

import { realPath } from './validation'

const logger = loggerService.withContext('NotesRelocation:Session')

const COMMIT_TIMEOUT_MS = 60_000

let migrationInFlight = false
let blockedRoots: { source: string; target: string } | null = null
let commitWatchTimer: NodeJS.Timeout | undefined
let commitWatchCleanup: (() => void) | undefined

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return isWin || isMac ? resolved.toLowerCase() : resolved
}

function pathUnderRoot(filePath: string, root: string): boolean {
  const file = normalizeForCompare(realPath(filePath))
  const base = normalizeForCompare(realPath(root))
  if (file === base) {
    return true
  }
  const relative = path.relative(base, file)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function clearCommitWatch(): void {
  if (commitWatchTimer) {
    clearTimeout(commitWatchTimer)
    commitWatchTimer = undefined
  }
  if (commitWatchCleanup) {
    commitWatchCleanup()
    commitWatchCleanup = undefined
  }
}

export function isNotesDirectoryMigrationInFlight(): boolean {
  return migrationInFlight
}

export function tryBeginNotesDirectoryMigration(): boolean {
  if (migrationInFlight) {
    return false
  }
  migrationInFlight = true
  return true
}

export function setNotesMigrationBlockedRoots(sourcePath: string, targetPath: string): void {
  blockedRoots = { source: realPath(sourcePath), target: realPath(targetPath) }
}

export function assertNotesPathNotMutatingDuringMigration(filePath: string): void {
  if (!blockedRoots) {
    return
  }
  const resolved = realPath(filePath)
  if (
    pathUnderRoot(resolved, blockedRoots.source) ||
    pathUnderRoot(resolved, blockedRoots.target)
  ) {
    throw new Error('Notes directory migration is in progress')
  }
}

export function releaseNotesMigrationSession(): void {
  migrationInFlight = false
  blockedRoots = null
  clearCommitWatch()
  application.get('IpcApiService').broadcast('app.notes_relocation.migration_finished', undefined)
}

export function completeNotesMigrationCommit(): void {
  if (!migrationInFlight) {
    return
  }
  releaseNotesMigrationSession()
}

export function scheduleAwaitingMigrationCommit(callerWindowId: WindowId | null): void {
  clearCommitWatch()
  commitWatchTimer = setTimeout(() => {
    logger.warn('Notes migration commit timed out; releasing renderer locks')
    releaseNotesMigrationSession()
  }, COMMIT_TIMEOUT_MS)
  commitWatchTimer.unref?.()

  if (callerWindowId == null) {
    return
  }
  const window = application.get('WindowManager').getWindow(callerWindowId)
  if (!window || window.isDestroyed()) {
    return
  }
  const onClosed = () => {
    logger.warn('Notes migration caller window closed before commit; releasing renderer locks')
    releaseNotesMigrationSession()
  }
  window.once('closed', onClosed)
  commitWatchCleanup = () => window.removeListener('closed', onClosed)
}
