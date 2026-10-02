import crypto from 'node:crypto'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/core/platform'
import type { WindowId } from '@shared/ipc/types'

import { realPath } from './validation'

const logger = loggerService.withContext('NotesRelocation:Session')

const COMMIT_TIMEOUT_MS = 60_000

let migrationInFlight = false
let activeSessionId: string | null = null
let blockedRoots: { source: string; target: string } | null = null
let activeNotesFilesystemMutations = 0
let notesFilesystemMutationIdleWaiters: Array<() => void> = []
let commitWatchTimer: NodeJS.Timeout | undefined
let commitWatchCleanup: (() => void) | undefined

function resolveNotesFilesystemMutationIdleWaiters(): void {
  if (activeNotesFilesystemMutations > 0) {
    return
  }
  const waiters = notesFilesystemMutationIdleWaiters
  notesFilesystemMutationIdleWaiters = []
  for (const resolve of waiters) {
    resolve()
  }
}

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
  activeSessionId = crypto.randomUUID()
  return true
}

export function getNotesMigrationSessionId(): string | null {
  return activeSessionId
}

export function setNotesMigrationBlockedRoots(sourcePath: string, targetPath: string): void {
  blockedRoots = { source: realPath(sourcePath), target: realPath(targetPath) }
}

export class NotesMigrationWriteBlockedError extends Error {
  constructor() {
    super('Notes directory migration is in progress')
    this.name = 'NotesMigrationWriteBlockedError'
  }
}

export function isNotesMigrationWriteBlockedError(error: unknown): error is NotesMigrationWriteBlockedError {
  return error instanceof NotesMigrationWriteBlockedError
}

export function assertNotesPathNotMutatingDuringMigration(filePath: string): void {
  if (!blockedRoots) {
    return
  }
  const resolved = realPath(filePath)
  if (pathUnderRoot(resolved, blockedRoots.source) || pathUnderRoot(resolved, blockedRoots.target)) {
    throw new NotesMigrationWriteBlockedError()
  }
}

export function beginNotesFilesystemMutation(): void {
  if (migrationInFlight) {
    throw new NotesMigrationWriteBlockedError()
  }
  activeNotesFilesystemMutations++
}

export function endNotesFilesystemMutation(): void {
  activeNotesFilesystemMutations--
  resolveNotesFilesystemMutationIdleWaiters()
}

export async function withNotesFilesystemMutation<T>(fn: () => Promise<T>): Promise<T> {
  beginNotesFilesystemMutation()
  try {
    return await fn()
  } finally {
    endNotesFilesystemMutation()
  }
}

export function waitForNotesFilesystemMutationsIdle(): Promise<void> {
  if (activeNotesFilesystemMutations === 0) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    notesFilesystemMutationIdleWaiters.push(resolve)
  })
}

export function beginNotesBatchMarkdownUpload(): void {
  beginNotesFilesystemMutation()
}

export function endNotesBatchMarkdownUpload(): void {
  endNotesFilesystemMutation()
}

export function waitForNotesBatchMarkdownUploadsIdle(): Promise<void> {
  return waitForNotesFilesystemMutationsIdle()
}

export function releaseNotesMigrationSession(): void {
  migrationInFlight = false
  activeSessionId = null
  blockedRoots = null
  clearCommitWatch()
  application.get('IpcApiService').broadcast('app.notes_relocation.migration_finished', undefined)
}

export function completeNotesMigrationCommit(sessionId: string): void {
  if (!migrationInFlight || activeSessionId !== sessionId) {
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
