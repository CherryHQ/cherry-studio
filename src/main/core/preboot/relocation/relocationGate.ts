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
 *   - Touches only `bootConfigService` and Electron `app`; it does NOT
 *     depend on any lifecycle-managed service (matches the preboot
 *     membership criterion in core/preboot/README.md).
 *   - Must run before `application.bootstrap()`. When it returns
 *     `'handled'`, the caller (main/index.ts) skips bootstrap entirely —
 *     the process is kept alive by the relocation window until the user
 *     clicks Restart, which relaunches with the freshly-committed path.
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

import { loggerService } from '@logger'
import { relocationWindowManager } from '@main/core/preboot/relocation/RelocationWindowManager'
import { commitRelocation } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import { RelocationIpcChannels, type RelocationProgress } from '@shared/data/relocation/types'
import { app, ipcMain } from 'electron'

const logger = loggerService.withContext('RelocationGate')

type PendingRelocation = Extract<NonNullable<BootConfigSchema['temp.user_data_relocation']>, { status: 'pending' }>

export type RelocationGateResult = 'handled' | 'skipped'

let currentProgress: RelocationProgress | null = null

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
  if (!pending || pending.status !== 'pending') return 'skipped'

  logger.info('Pending userData relocation detected', {
    from: pending.from,
    to: pending.to,
    copy: pending.copy
  })

  await app.whenReady()
  registerRelocationIpcHandlers()
  relocationWindowManager.create()
  await relocationWindowManager.waitForReady()

  // Paint the window immediately so the user sees "preparing" before the
  // (potentially slow) byte-total computation begins.
  currentProgress = makeProgress('preparing', pending, 0, 0)
  relocationWindowManager.sendProgress(currentProgress)

  try {
    if (pending.copy) {
      const total = await calcTotalBytes(pending.from)
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

    currentProgress = makeProgress('completed', pending, 0, 0)
    relocationWindowManager.sendProgress(currentProgress)
    logger.info('userData relocation completed', { from: pending.from, to: pending.to })
  } catch (error) {
    const message = (error as Error).message
    logger.error('userData relocation failed; staying on previous location', {
      from: pending.from,
      to: pending.to,
      error: message
    })
    // Mark the request failed so a future recovery UI can explain what
    // happened. It will not auto-retry because only `pending` is executed.
    // The user keeps running on the OLD location (app.user_data_path is
    // unchanged) until they initiate another relocation from settings.
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
 * Synchronous pre-flight checks. Fail fast before any bytes are copied so
 * we don't leave partial data under `to` on trivially-preventable errors.
 * The renderer/IPC layer is the first line of defense, but BootConfig can
 * also be edited by hand, so preboot re-checks here.
 */
function preflight(from: string, to: string): void {
  const fromAbs = path.resolve(from)
  const toAbs = path.resolve(to)
  if (fromAbs === toAbs) {
    throw new Error(`source and target are the same path: ${fromAbs}`)
  }
  // Target inside source would make the recursive copy recurse into its
  // own output. path.sep guards against a false positive when `from` is a
  // prefix of an unrelated sibling directory (e.g. /a vs /ab).
  if (toAbs.startsWith(fromAbs + path.sep)) {
    throw new Error(`target is inside source (would recurse): ${toAbs}`)
  }
  if (!fs.existsSync(from)) {
    throw new Error(`source does not exist: ${from}`)
  }
  const toParent = path.dirname(to)
  if (!fs.existsSync(toParent)) {
    throw new Error(`target parent directory does not exist: ${toParent}`)
  }
  fs.accessSync(toParent, fs.constants.W_OK)
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
    } catch {
      // Unreadable subdir (e.g. permission) — skip rather than fail.
      continue
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
        } catch {
          // stat failure (broken sock / fifo) — skip.
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
 * Locked files (Windows Chromium runtime cache held by the relocation
 * window's own session) are retried a few times and then skipped with a
 * warning rather than failing the whole relocation — they are
 * non-essential and regenerated on the next launch.
 */
async function copyTreeWithProgress(
  from: string,
  to: string,
  total: number,
  onTick: (copied: number) => void
): Promise<void> {
  preflight(from, to)
  const acc = { bytes: 0 }
  await copyDir(from, to, total, onTick, acc)
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
      // verbatimSymlinks equivalent: keep the link as-is.
      try {
        const target = await fsp.readlink(srcPath)
        await fsp.rm(dstPath, { force: true })
        await fsp.symlink(target, dstPath)
      } catch (error) {
        logger.warn('Failed to mirror symlink, skipping', { srcPath, error: (error as Error).message })
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
        logger.warn('Failed to copy file after retries, skipping', {
          src,
          error: (error as Error).message
        })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}
