/**
 * Preboot gate that executes a pending userData relocation.
 *
 * Counterpart to `requestRelocation()` in `userDataLocation.ts`: the
 * renderer writes `temp.user_data_relocation = { status: 'pending', ... }`
 * and relaunches; on the next launch this gate sees the pending request,
 * opens a dedicated window, performs the copy (when requested), commits
 * the new path to BootConfig, and relaunches again.
 *
 * Timing contract (mirrors `v2MigrationGate`):
 *   - Runs during preboot, but async — it `await`s app.whenReady() and the
 *     relocation window's ready barrier.
 *   - Touches only `bootConfigService`, Electron `app`, and the already
 *     initialized path registry; it does NOT depend on any lifecycle-managed
 *     service (matches the preboot membership criterion in
 *     core/preboot/README.md).
 *   - Must run before `application.bootstrap()`. When it returns
 *     `'handled'`, the caller (main/index.ts) skips bootstrap entirely.
 *     On success the process relaunches itself immediately after
 *     committing the new path; on failure it returns `'handled'` and
 *     stays alive via the relocation window until the user clicks
 *     Restart.
 *
 * Why the copy happens here (preboot), not while the app is running:
 *   - At this point the previous process has fully exited, so NO file in
 *     the OLD userData is locked. v1 used to split the copy into
 *     "occupied" (locked) vs "non-occupied" dirs and copy them in two
 *     phases; v2 abandons that distinction — the whole tree is copied as
 *     one unit after exit. See the "Terminology" block in
 *     userDataLocation.ts.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { relocationWindowManager } from '@main/core/preboot/relocation/RelocationWindowManager'
import { commitRelocation } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import { RelocationIpcChannels, type RelocationProgress } from '@shared/data/relocation/types'
import { isProtectedSystemPathOrDescendant } from '@shared/utils/file'
import { app, dialog, ipcMain } from 'electron'

const logger = loggerService.withContext('RelocationGate')

type PendingRelocation = Extract<NonNullable<BootConfigSchema['temp.user_data_relocation']>, { status: 'pending' }>

export type RelocationGateResult = 'handled' | 'skipped'

let currentProgress: RelocationProgress | null = null

const CHERRY_USER_DATA_MARKER_FILES = new Set(['cherrystudio.sqlite', 'version.log'])
const CHERRY_USER_DATA_DATA_DIR_MARKERS = new Set(['Files', 'KnowledgeBase', 'Notes', 'Skills', 'Agents', 'Channels'])

/**
 * Decide whether a pending userData relocation must run before
 * `application.bootstrap()`.
 *
 * Returns `'skipped'` when there is nothing to do (no pending request, or
 * dev mode where relocation is a packaged-only concern) — the caller
 * proceeds with normal startup. Returns `'handled'` when a relocation was
 * (or is being) performed: the relocation window is now showing the result
 * and the caller MUST skip bootstrap and return.
 */
export async function runUserDataRelocationGate(): Promise<RelocationGateResult> {
  // Relocation is a packaged-only concern — dev runs use a 'Dev'-suffixed
  // userData (see resolveUserDataLocation) and never read BootConfig
  // relocation state.
  if (!app.isPackaged) return 'skipped'

  const pending = bootConfigService.get('temp.user_data_relocation')
  if (!pending) return 'skipped'
  if (pending.status === 'failed') {
    logger.warn('Clearing failed userData relocation record from previous launch', {
      from: pending.from,
      to: pending.to,
      error: pending.error
    })
    await app.whenReady()
    showFailedRelocationDialog(pending)
    bootConfigService.set('temp.user_data_relocation', null)
    bootConfigService.flush()
    return 'skipped'
  }

  logger.info('Pending userData relocation detected', {
    from: pending.from,
    to: pending.to,
    copy: pending.copy
  })

  await app.whenReady()
  registerRelocationIpcHandlers()

  try {
    relocationWindowManager.create()
    await relocationWindowManager.waitForReady()

    // Paint the window immediately so the user sees "preparing" before the
    // (potentially slow) byte-total computation begins.
    currentProgress = makeProgress('preparing', pending, 0, 0)
    relocationWindowManager.sendProgress(currentProgress)

    preflight(pending.from, pending.to, pending.copy)

    if (pending.copy) {
      const total = await calcTotalBytes(pending.from)
      await ensureAvailableSpace(pending.to, total)
      currentProgress = makeProgress('copying', pending, 0, total)
      relocationWindowManager.sendProgress(currentProgress)

      let lastPercent = -1
      await copyTreeWithProgress(pending.from, pending.to, total, (copied) => {
        const percent = total > 0 ? Math.floor((copied / total) * 100) : 0
        // Throttle: only push when the integer percent moves, so a tree of
        // tens of thousands of small files doesn't flood the renderer.
        if (percent === lastPercent) return
        lastPercent = percent
        currentProgress = makeProgress('copying', pending, copied, total)
        relocationWindowManager.sendProgress(currentProgress)
      })
    }

    currentProgress = makeProgress('committing', pending, 0, 0)
    relocationWindowManager.sendProgress(currentProgress)
    commitRelocation(pending.to)
    logger.info('userData relocation completed; restarting', { from: pending.from, to: pending.to })

    // Relaunch immediately after commit: a manual launch before exit
    // would read the new path, grab a different single-instance lock,
    // and start a full bootstrap — breaking the one-live-process invariant.
    await relocationWindowManager.restartApp()
  } catch (error) {
    const message = (error as Error).message
    logger.error('userData relocation failed; staying on previous location', {
      from: pending.from,
      to: pending.to,
      error: message
    })
    // Mark the request failed so this launch can show the terminal failure
    // state. The next normal launch clears the failed marker rather than
    // leaving stale temp state in BootConfig indefinitely.
    bootConfigService.set('temp.user_data_relocation', {
      status: 'failed',
      from: pending.from,
      to: pending.to,
      error: message,
      failedAt: new Date().toISOString()
    })
    bootConfigService.flush()
    currentProgress = makeProgress('failed', pending, 0, 0, message)
    relocationWindowManager.sendProgress(currentProgress)
    if (relocationWindowManager.shouldRestartAfterTerminalFailure() || !relocationWindowManager.hasWindow()) {
      logger.warn('Restarting after headless relocation failure')
      await relocationWindowManager.restartApp()
    }
  }

  return 'handled'
}

function registerRelocationIpcHandlers(): void {
  ipcMain.handle(RelocationIpcChannels.GetProgress, () => currentProgress)
  ipcMain.handle(RelocationIpcChannels.Restart, () => {
    void relocationWindowManager.restartApp()
    return true
  })
}

function showFailedRelocationDialog(
  pending: Extract<NonNullable<BootConfigSchema['temp.user_data_relocation']>, { status: 'failed' }>
): void {
  try {
    dialog.showMessageBoxSync({
      type: 'error',
      buttons: ['OK'],
      title: 'Data directory relocation failed',
      message: 'Cherry Studio could not relocate the data directory.',
      detail: `The app will continue using the previous data directory.\n\nFrom: ${pending.from}\nTo: ${pending.to}\n\nError: ${pending.error}`
    })
  } catch (error) {
    logger.error('Failed to show relocation failure dialog', { error: (error as Error).message })
  }
}

function makeProgress(
  stage: RelocationProgress['stage'],
  pending: PendingRelocation,
  bytesCopied: number,
  bytesTotal: number,
  error?: string
): RelocationProgress {
  return {
    stage,
    from: pending.from,
    to: pending.to,
    copy: pending.copy,
    bytesCopied,
    bytesTotal,
    ...(error !== undefined ? { error } : {})
  }
}

/**
 * Synchronous path checks. The renderer/IPC layer is the first line of
 * defense, but BootConfig can also be edited by hand, so preboot re-checks
 * here before either switching or copying.
 */
function preflight(from: string, to: string, copy: boolean): void {
  const fromAbs = resolveForPathCompare(from)
  const toAbs = resolveForPathCompare(to)
  if (!isAbsolutePath(from)) {
    throw new Error(`source must be an absolute path: ${from}`)
  }
  if (!isAbsolutePath(to)) {
    throw new Error(`target must be an absolute path: ${to}`)
  }
  if (fromAbs === toAbs) {
    throw new Error(`source and target are the same path: ${fromAbs}`)
  }
  if (copy) {
    assertSourceDirectoryReadable(from)
  }
  if (getPathDepth(toAbs) <= 1) {
    throw new Error(`target must not be a root or top-level path: ${toAbs}`)
  }
  if (isProtectedSystemPathOrDescendant(toAbs)) {
    throw new Error(`target must not be a protected system path: ${toAbs}`)
  }
  if (isExistingMountRoot(to)) {
    throw new Error(`target must not be a mounted volume root: ${toAbs}`)
  }
  if (copy) {
    // Target inside source would make the recursive copy recurse into its
    // own output. The path relation helper avoids false positives when `from`
    // is a prefix of an unrelated sibling directory (e.g. /a vs /ab).
    if (isPathInside(toAbs, fromAbs)) {
      throw new Error(`target is inside source (would recurse): ${toAbs}`)
    }
    if (isPathInside(fromAbs, toAbs)) {
      throw new Error(`source is inside target (would merge userData into an ancestor): ${toAbs}`)
    }
  }
  const toParent = path.dirname(to)
  if (!fs.existsSync(toParent)) {
    throw new Error(`target parent directory does not exist: ${toParent}`)
  }
  fs.accessSync(toParent, fs.constants.W_OK)
  const installPath = resolveForPathCompare(application.getPath('app.install'))
  const toRealAbs = resolveTargetRealPathForCompare(to)
  if (copy) {
    const fromRealAbs = resolveExistingRealPathForCompare(from)
    if (fromRealAbs === toRealAbs) {
      throw new Error(`source and target resolve to the same path: ${fromRealAbs}`)
    }
    if (isPathInside(toRealAbs, fromRealAbs)) {
      throw new Error(`target real path is inside source real path (would recurse): ${toRealAbs}`)
    }
    if (isPathInside(fromRealAbs, toRealAbs)) {
      throw new Error(
        `source real path is inside target real path (would merge userData into an ancestor): ${toRealAbs}`
      )
    }
    if (toRealAbs !== toAbs && isPathInside(toRealAbs, fromAbs)) {
      throw new Error(`target real path is not safe: ${toRealAbs}`)
    }
  }
  if (toRealAbs === installPath || isPathInside(toRealAbs, installPath)) {
    throw new Error(`target must not be inside the app install path: ${toRealAbs}`)
  }
  if (isProtectedSystemPathOrDescendant(toRealAbs)) {
    throw new Error(`target real path must not be a protected system path: ${toRealAbs}`)
  }
  assertTargetDirectoryIsSafeToReplace(to, copy)
}

function isAbsolutePath(p: string): boolean {
  const ops = isWin ? path.win32 : path
  return ops.isAbsolute(p)
}

function resolveForPathCompare(p: string): string {
  const ops = isWin ? path.win32 : path
  const resolved = ops.resolve(p)
  return isWin ? resolved.toLowerCase() : resolved
}

function resolveTargetRealPathForCompare(to: string): string {
  const ops = isWin ? path.win32 : path
  const rawRealPath = fs.existsSync(to) ? getRealPath(to) : ops.join(getRealPath(ops.dirname(to)), ops.basename(to))
  return resolveForPathCompare(rawRealPath)
}

function resolveExistingRealPathForCompare(p: string): string {
  return resolveForPathCompare(getRealPath(p))
}

function getRealPath(p: string): string {
  const realpathSync = fs.realpathSync as typeof fs.realpathSync & { native?: typeof fs.realpathSync }
  return realpathSync.native?.(p) ?? realpathSync(p)
}

function isPathInside(child: string, parent: string): boolean {
  const ops = isWin ? path.win32 : path
  const relative = ops.relative(parent, child)
  return relative.length > 0 && !relative.startsWith('..') && !ops.isAbsolute(relative)
}

function getPathDepth(p: string): number {
  const ops = isWin ? path.win32 : path
  const parsed = ops.parse(p)
  return p.slice(parsed.root.length).split(ops.sep).filter(Boolean).length
}

function isExistingMountRoot(p: string): boolean {
  const ops = isWin ? path.win32 : path
  const target = ops.resolve(p)
  const parent = ops.dirname(target)
  if (parent === target) return true

  try {
    const targetStat = fs.statSync(target)
    const parentStat = fs.statSync(parent)
    return targetStat.dev !== parentStat.dev
  } catch {
    return false
  }
}

function assertTargetDirectoryIsSafeToReplace(to: string, copy: boolean): void {
  if (!fs.existsSync(to)) {
    if (!copy) {
      throw new Error(`switch target directory does not exist: ${to}`)
    }
    return
  }

  const lstat = fs.lstatSync(to)
  if (typeof lstat.isSymbolicLink === 'function' && lstat.isSymbolicLink()) {
    throw new Error(`target must not be a symlink: ${to}`)
  }

  const stat = fs.statSync(to)
  if (typeof stat.isDirectory === 'function' && !stat.isDirectory()) {
    throw new Error(`target exists and is not a directory: ${to}`)
  }

  if (!copy) {
    try {
      fs.accessSync(to, fs.constants.W_OK)
    } catch (error) {
      throw new Error(`switch target directory is not writable: ${to}: ${(error as Error).message}`)
    }
    const entries = fs.readdirSync(to)
    if (entries.length > 0 && !isRecognizedCherryUserDataDirectory(to, entries)) {
      throw new Error(`switch target directory is not recognized as Cherry Studio userData: ${to}`)
    }
    return
  }

  const entries = fs.readdirSync(to)
  if (entries.length > 0 && !confirmTargetOverwrite(to)) {
    throw new Error(`target directory is not empty and overwrite was not confirmed: ${to}`)
  }
}

function isRecognizedCherryUserDataDirectory(to: string, entries = fs.readdirSync(to)): boolean {
  if (entries.some((entry) => CHERRY_USER_DATA_MARKER_FILES.has(entry))) return true
  if (!entries.includes('Data')) return false

  try {
    const dataEntries = fs.readdirSync(path.join(to, 'Data'))
    return dataEntries.some((entry) => CHERRY_USER_DATA_DATA_DIR_MARKERS.has(entry))
  } catch {
    return false
  }
}

function confirmTargetOverwrite(to: string): boolean {
  const response = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['Cancel', 'Overwrite'],
    defaultId: 0,
    cancelId: 0,
    title: 'Overwrite existing data directory?',
    message: 'The selected target directory is not empty.',
    detail:
      `Cherry Studio will replace the contents of:\n${to}\n\n` +
      'Only continue if you are sure this directory can be overwritten.'
  })
  return response === 1
}

function assertSourceDirectoryReadable(from: string): void {
  if (!fs.existsSync(from)) {
    throw new Error(`source does not exist: ${from}`)
  }
  const lstat = fs.lstatSync(from)
  if (typeof lstat.isSymbolicLink === 'function' && lstat.isSymbolicLink()) {
    throw new Error(`source must not be a symlink: ${from}`)
  }
  const stat = fs.statSync(from)
  if (typeof stat.isDirectory === 'function' && !stat.isDirectory()) {
    throw new Error(`source exists and is not a directory: ${from}`)
  }
  try {
    fs.accessSync(from, fs.constants.R_OK)
  } catch (error) {
    throw new Error(`source directory is not readable: ${from}: ${(error as Error).message}`)
  }
}

async function ensureAvailableSpace(to: string, requiredBytes: number): Promise<void> {
  if (requiredBytes <= 0) return

  const stats = await fsp.statfs(path.dirname(to))
  const availableBytes = stats.bavail * stats.bsize
  if (availableBytes < requiredBytes) {
    throw new Error(
      `target volume does not have enough free space: required ${requiredBytes} bytes, available ${availableBytes} bytes`
    )
  }
}

/**
 * Recursively compute the total byte count of a directory tree (files
 * only; symlinks and special files are skipped). Used to drive the copy
 * progress bar. Runs in `preparing` — a multi-GB tree can take a few
 * seconds to enumerate.
 */
async function calcTotalBytes(src: string): Promise<number> {
  let total = 0
  const stack: string[] = [src]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (error) {
      throw new Error(`source directory is not readable: ${dir}: ${(error as Error).message}`)
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(p)
      } else {
        try {
          const s = await fsp.stat(p)
          total += s.size
        } catch (error) {
          throw new Error(`source file is not readable: ${p}: ${(error as Error).message}`)
        }
      }
    }
  }
  return total
}

/**
 * Recursive copy that reports accumulated copied bytes via `onTick`.
 *
 * Mirrors the semantics of the previous synchronous `cpSync` call (force
 * overwrite, keep symlinks as symlinks), but async so the main process
 * isn't blocked and progress can stream to the window.
 *
 * Copy first into a sibling temporary directory. Only after the source tree
 * has been fully copied do we replace the requested target, so a late source
 * read/copy failure does not destroy the user's existing target directory.
 */
async function copyTreeWithProgress(
  from: string,
  to: string,
  total: number,
  onTick: (copied: number) => void
): Promise<void> {
  const acc = { bytes: 0 }
  const tempTo = makeTemporaryTargetPath(to)
  await fsp.rm(tempTo, { recursive: true, force: true })
  try {
    await copyDir(from, tempTo, total, onTick, acc)
    await replaceTargetWithRollback(tempTo, to)
  } catch (error) {
    await fsp.rm(tempTo, { recursive: true, force: true }).catch((cleanupError) => {
      logger.error('Failed to remove partial relocation target', {
        to: tempTo,
        error: (cleanupError as Error).message
      })
      throw new Error(
        `copy failed: ${(error as Error).message}; partial target cleanup failed, manual cleanup required at ${tempTo}: ${
          (cleanupError as Error).message
        }`
      )
    })
    throw error
  }
}

function makeTemporaryTargetPath(to: string): string {
  return path.join(path.dirname(to), `.${path.basename(to)}.relocation-${process.pid}-${Date.now()}`)
}

function makeBackupTargetPath(to: string): string {
  return path.join(path.dirname(to), `.${path.basename(to)}.relocation-backup-${process.pid}-${Date.now()}`)
}

async function replaceTargetWithRollback(tempTo: string, to: string): Promise<void> {
  const backupTo = makeBackupTargetPath(to)
  let hasBackup = false

  try {
    await fsp.rm(backupTo, { recursive: true, force: true })
    if (fs.existsSync(to)) {
      await fsp.rename(to, backupTo)
      hasBackup = true
    }

    await fsp.rename(tempTo, to)

    if (hasBackup) {
      await fsp.rm(backupTo, { recursive: true, force: true })
    }
  } catch (error) {
    if (hasBackup) {
      try {
        await fsp.rm(to, { recursive: true, force: true })
        await fsp.rename(backupTo, to)
      } catch (restoreError) {
        throw new Error(
          `target replacement failed: ${(error as Error).message}; target restore failed, manual restore required from ${backupTo}: ${
            (restoreError as Error).message
          }`
        )
      }
    }
    throw error
  }
}

async function copyDir(
  src: string,
  dst: string,
  total: number,
  onTick: (copied: number) => void,
  acc: { bytes: number }
): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true })
  await fsp.mkdir(dst, { recursive: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const dstPath = path.join(dst, entry.name)

    if (entry.isSymbolicLink()) {
      // Match cpSync({ verbatimSymlinks: true }): preserve links as links.
      // Progress intentionally counts regular file payload bytes only.
      try {
        const target = await fsp.readlink(srcPath)
        await fsp.rm(dstPath, { force: true })
        await fsp.symlink(target, dstPath)
      } catch (error) {
        logger.error('Failed to mirror symlink', { srcPath, error: (error as Error).message })
        throw error
      }
      continue
    }

    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath, total, onTick, acc)
      continue
    }

    if (entry.isFile()) {
      let size = 0
      try {
        size = (await fsp.stat(srcPath)).size
      } catch {
        // fall through with size 0
      }
      await copyFileWithRetry(srcPath, dstPath)
      acc.bytes += size
      onTick(acc.bytes)
      continue
    }

    // FIFO / socket / char|block device — skip (not meaningful to copy).
  }
}

async function copyFileWithRetry(src: string, dst: string, retries = 3): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.copyFile(src, dst)
      return
    } catch (error) {
      if (attempt >= retries) {
        logger.error('Failed to copy file after retries', {
          src,
          error: (error as Error).message
        })
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}
