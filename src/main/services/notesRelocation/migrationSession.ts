import crypto from 'node:crypto'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/core/platform'
import type { WindowId } from '@shared/ipc/types'

import { clearRendererMigrationLockBroadcast } from './rendererEditFlush'
import { isAllowedNotesDirectory, realPath, resolveExistingAncestor } from './validation'

const logger = loggerService.withContext('NotesRelocation:Session')

const COMMIT_TIMEOUT_MS = 60_000

let migrationInFlight = false
let activeSessionId: string | null = null
let blockedRoots: { source: string; target: string } | null = null
// Migration root pairs recorded at release. Enforcement is write-time, not a
// release-time latch: a preference flip can land AFTER a source-active
// release, and only re-reading the canonical configured root when a write
// targets a recorded root keeps that late flip from silently orphaning the
// write. In-memory only: a crash or restart clears the record, and reopening
// resolves against the canonical configured root again.
let migrationPairs: { source: string; target: string }[] = []
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

function effectiveFilesystemPath(filePath: string): string {
  return resolveExistingAncestor(path.resolve(filePath)).effectivePath
}

function pathUnderRoot(filePath: string, root: string): boolean {
  const file = normalizeForCompare(effectiveFilesystemPath(filePath))
  const base = normalizeForCompare(realPath(root))
  if (file === base) {
    return true
  }
  const relative = path.relative(base, file)
  if (relative === '' || relative === '..' || path.isAbsolute(relative)) {
    return false
  }
  return !relative.startsWith(`..${path.sep}`)
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

export class NotesRetiredRootWriteError extends Error {
  constructor() {
    super('Notes directory was relocated; this copy is no longer the configured notes root')
    this.name = 'NotesRetiredRootWriteError'
  }
}

export function isNotesRetiredRootWriteError(error: unknown): error is NotesRetiredRootWriteError {
  return error instanceof NotesRetiredRootWriteError
}

type ActiveRootResolution = { state: 'source-active' | 'target-active' } | { state: 'unresolved'; reason: string }

/**
 * Resolve which migration root the canonical configured notes path points at.
 * The renderer flips the preference BEFORE committing, and a commit can also
 * arrive from the renderer's catch path, so arrival order alone never proves
 * the flip landed - read the raw preference with its provenance instead.
 */
function resolveActiveMigrationRoot(roots: { source: string; target: string }): ActiveRootResolution {
  try {
    const read = application.get('PreferenceService').getWithProvenance('feature.notes.path')
    if (read.provenance === 'not-ready') {
      return { state: 'unresolved', reason: 'preference cache not ready' }
    }
    const raw = typeof read.value === 'string' ? read.value.trim() : ''
    let configuredReal: string
    if (!raw) {
      // An unset preference is an affirmative default root.
      configuredReal = realPath(application.getPath('feature.notes.data'))
    } else {
      const normalized = path.resolve(raw)
      if (!isAllowedNotesDirectory(normalized)) {
        return {
          state: 'unresolved',
          reason: `configured notes path is not an allowed notes directory: ${normalized}`
        }
      }
      configuredReal = realPath(normalized)
    }
    if (configuredReal === roots.target) {
      return { state: 'target-active' }
    }
    if (configuredReal === roots.source) {
      return { state: 'source-active' }
    }
    return { state: 'unresolved', reason: `configured notes root matches neither migration root: ${configuredReal}` }
  } catch (error) {
    return { state: 'unresolved', reason: (error as Error).message }
  }
}

/**
 * Reject path-kind edits under a retired migration root. The canonical root
 * is re-read on every call so a preference flip landing after the migration
 * released still retires the source, and a once-unresolved root accepts edits
 * again as soon as the configured root resolves - reopening is the recovery,
 * and only a target-active source stays retired.
 */
export function assertNotesPathNotRetired(filePath: string): void {
  if (migrationPairs.length === 0) {
    return
  }
  const resolved = effectiveFilesystemPath(filePath)
  for (const pair of migrationPairs) {
    const underSource = pathUnderRoot(resolved, pair.source) || pathUnderRoot(pair.source, resolved)
    const underTarget = pathUnderRoot(resolved, pair.target) || pathUnderRoot(pair.target, resolved)
    if (!underSource && !underTarget) {
      continue
    }
    const active = resolveActiveMigrationRoot(pair)
    switch (active.state) {
      case 'target-active':
        // The configured root moved: the source copy is retired.
        if (underSource) throw new NotesRetiredRootWriteError()
        break
      case 'source-active':
        // The flip never landed: both copies stay editable at their roots.
        break
      case 'unresolved':
        // Close loud under both roots until the canonical root resolves.
        throw new NotesRetiredRootWriteError()
    }
  }
}

/** Test hook: migration root pairs are per-app-run module state. */
export function clearNotesMigrationPairsForTests(): void {
  migrationPairs = []
}

export function assertNotesPathNotMutatingDuringMigration(filePath: string): void {
  if (!blockedRoots) {
    return
  }
  const resolved = effectiveFilesystemPath(filePath)
  for (const root of [blockedRoots.source, blockedRoots.target]) {
    // Block descendants (writes inside the library) and ancestors (renames/moves of a parent folder).
    if (pathUnderRoot(resolved, root) || pathUnderRoot(root, resolved)) {
      throw new NotesMigrationWriteBlockedError()
    }
  }
}

export function beginNotesFilesystemMutation(): void {
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
  if (migrationInFlight) {
    throw new NotesMigrationWriteBlockedError()
  }
  beginNotesFilesystemMutation()
}

export function endNotesBatchMarkdownUpload(): void {
  endNotesFilesystemMutation()
}

export function waitForNotesBatchMarkdownUploadsIdle(): Promise<void> {
  return waitForNotesFilesystemMutationsIdle()
}

export function releaseNotesMigrationSession(): void {
  if (blockedRoots) {
    migrationPairs.push(blockedRoots)
    const active = resolveActiveMigrationRoot(blockedRoots)
    if (active.state === 'unresolved') {
      logger.warn(
        'Notes migration release could not resolve the configured root; writes under both roots close loud until it resolves',
        { reason: active.reason }
      )
    } else {
      logger.info(
        `Notes migration released with ${active.state === 'target-active' ? 'target' : 'source'} root configured`
      )
    }
  }
  migrationInFlight = false
  activeSessionId = null
  blockedRoots = null
  clearCommitWatch()
  clearRendererMigrationLockBroadcast()
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
