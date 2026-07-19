import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { canonicalizeUserDataPath, getNormalizedExecutablePath } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import type { RelocationProgress } from '@shared/types/relocation'
import { app } from 'electron'
import * as z from 'zod'

import type { FailedRelocation, PendingRelocation, RelocationState } from './types'
import {
  assertEffectiveSeparation,
  assertEmptyDirectory,
  assertRelocationPaths,
  assertUserDataRelocationRequest,
  invalid,
  isErrno,
  isPathInside,
  normalizeForCompare,
  pathEntryExists,
  realPath,
  relocationArtifactPaths,
  resolveEffectivePath,
  resolveExistingAncestor
} from './validation'
import { openUserDataRelocationWindow, type UserDataRelocationWindow } from './window'

/**
 * Execution face — the launch-time half of userData relocation.
 *
 * main.ts calls runUserDataRelocation() during preboot, right after the path
 * registry is initialized and before any lifecycle service opens files under
 * the source userData directory. Preboot timing imposes hard constraints on
 * everything here: no lifecycle service exists yet (never `application.get()`),
 * the dedicated window bypasses WindowManager, and an error escaping before
 * the window exists would hard-exit with no UI and replay the still-pending
 * request on every launch — so every failure path must degrade to a persisted
 * failed state instead of throwing. See ./README.md.
 */

const logger = loggerService.withContext('UserDataRelocation')

// Ownership marker dropped into every directory this task creates. Recovery
// and rollback delete a tree recursively only when the marker matches the
// task ID, so user data that happens to sit at an artifact path is never
// removed.
const RELOCATION_OWNER_MARKER = '.cherry-relocation-owner.json'
// The copy lands in workPath/payload/, not in workPath itself: fsp.cp must be
// the one to create its destination (see the cp call below), while the
// recovery invariant needs the owner marker inside workPath before the first
// payload byte lands. Two constraints, one directory level each.
const RELOCATION_PAYLOAD_DIRNAME = 'payload'
// The copy can transiently need more space than the source occupies
// (allocation rounding, filesystem metadata), and filling the destination
// volume to the last byte would break the app that boots from it.
const FREE_SPACE_SAFETY_FACTOR = 1.2

const relocationOwnerSchema = z.object({
  kind: z.literal('cherry-studio-user-data-relocation'),
  taskId: z.string()
})

/**
 * Sole flow entry, called once per launch from main.ts. Returns 'handled'
 * when this launch belongs to relocation (the caller must stop normal
 * startup — the flow ends in a relaunch), 'skipped' when there is nothing
 * to do and startup continues.
 */
export async function runUserDataRelocation(): Promise<'handled' | 'skipped'> {
  let relocation = readUserDataRelocationState()
  if (!relocation) return 'skipped'

  // Every pending relocation isolates sessionData (strictly only the copy
  // needs the source tree quiescent — for a switch it is merely harmless).
  // A failed-state launch just shows the error window, so it must not depend
  // on the temp filesystem — otherwise a broken environment would also block
  // the error explanation.
  if (relocation.status === 'pending') {
    relocation = prepareIsolatedSessionData(relocation)
  }

  await app.whenReady()

  let currentProgress: RelocationProgress | null = null
  function restart() {
    if (currentProgress?.stage === 'failed') clearRelocationState()
    application.relaunch()
  }
  const relocationWindow: UserDataRelocationWindow = openUserDataRelocationWindow({
    getProgress: () => currentProgress,
    onRestart: restart
  })
  await relocationWindow.waitForReady()

  const publish = (progress: RelocationProgress) => {
    currentProgress = progress
    relocationWindow.updateProgress(progress)
  }

  if (relocation.status === 'failed') {
    publish(makeProgress('failed', relocation, 0, 0, relocation.error))
    if (relocationWindow.isUnavailable()) restart()
    return 'handled'
  }

  try {
    publish(makeProgress('preparing', relocation, 0, 0))
    await executeRelocation(relocation, publish, () => {
      publish(makeProgress('committing', relocation, 0, 0))
      commitUserDataRelocation(relocation.to)
    })
    publish(makeProgress('completed', relocation, 0, 0))
    logger.info('userData relocation completed; waiting to relaunch', {
      from: relocation.from,
      to: relocation.to,
      copy: relocation.copy
    })
    if (relocationWindow.isUnavailable() || !relocationWindow.hasWindow()) restart()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('userData relocation failed; keeping previous location', {
      from: relocation.from,
      to: relocation.to,
      error: message
    })
    // The filesystem has already been rolled back (if the rollback itself
    // failed, that failure is part of the message).
    persistFailedRelocation(relocation, message)
    publish(makeProgress('failed', relocation, 0, 0, message))
    if (relocationWindow.isUnavailable() || !relocationWindow.hasWindow()) restart()
  }

  return 'handled'
}

/**
 * Redirect Chromium's sessionData to a throwaway per-task directory. Must
 * complete before the first `app.whenReady()` await — once Chromium opens the
 * profile it starts writing into the source tree, which would make the copy
 * inconsistent.
 */
function prepareIsolatedSessionData(pending: PendingRelocation): RelocationState {
  try {
    const sessionRoot = application.getPath('app.temp', 'relocation-session')
    fs.mkdirSync(sessionRoot, { recursive: true, mode: 0o700 })
    const sessionDataPath = fs.mkdtempSync(path.join(sessionRoot, `${pending.taskId}-`))
    app.setPath('sessionData', sessionDataPath)
    logger.info('Prepared isolated sessionData for userData relocation', { sessionDataPath })
    return pending
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Failing the relocation here (instead of throwing) matters: an escaped
    // error would hard-exit before any window exists, and the still-pending
    // request would repeat that on every launch — an unrecoverable boot loop.
    logger.error('Could not prepare isolated sessionData; failing relocation', { taskId: pending.taskId, error })
    return persistFailedRelocation(pending, `failed to prepare isolated sessionData: ${message}`)
  }
}

function persistFailedRelocation(pending: PendingRelocation, message: string): FailedRelocation {
  const failed: FailedRelocation = {
    status: 'failed',
    taskId: pending.taskId,
    from: pending.from,
    to: pending.to,
    copy: pending.copy,
    error: message,
    failedAt: new Date().toISOString()
  }
  bootConfigService.set('temp.user_data_relocation', failed)
  // A BootConfig write failure must not crash preboot before the recovery
  // window can explain the error; flush() is best-effort and only logs.
  bootConfigService.flush()
  return failed
}

function readUserDataRelocationState(): RelocationState | null {
  // Unpackaged dev runs use the suffixed dev userData and never execute
  // relocations (mirrors the request-side isPackaged gate in ipc/handlers).
  if (!app.isPackaged) return null

  // BootConfigService already validates this key against the shared zod schema
  // on load and set, so a non-null value here is structurally trustworthy.
  const relocation = bootConfigService.get('temp.user_data_relocation')
  if (!relocation) return null

  // A request whose `from` is not the userData this launch resolved was
  // recorded under different conditions (executable moved, BootConfig copied
  // to another machine). Executing it would relocate the wrong tree — discard.
  const currentUserDataPath = application.getPath('app.userdata')
  const currentUserData = normalizeForCompare(currentUserDataPath)
  if (normalizeForCompare(relocation.from) !== currentUserData) {
    logger.warn('Discarding stale userData relocation request', {
      requestedFrom: relocation.from,
      currentUserData: currentUserDataPath
    })
    clearRelocationState()
    return null
  }
  return relocation
}

async function executeRelocation(
  pending: PendingRelocation,
  publish: (progress: RelocationProgress) => void,
  commit: () => void
): Promise<void> {
  if (pending.copy) {
    assertRelocationPaths(pending.from, pending.to, {
      allowRelocationArtifacts: true,
      taskId: pending.taskId
    })
    await recoverInterruptedCopy(pending)
  }
  assertUserDataRelocationRequest(pending)

  if (!pending.copy) {
    commit()
    return
  }

  const total = await calculateTotalBytes(pending.from)
  await assertEnoughFreeSpace(pending.to, total)
  publish(makeProgress('copying', pending, 0, total))

  const { workPath, asidePath } = relocationArtifactPaths(pending.to, pending.taskId)
  const payloadPath = path.join(workPath, RELOCATION_PAYLOAD_DIRNAME)
  let asideCreated = false
  let promoted = false

  try {
    // The source scan can take minutes. Revalidate immediately before claiming
    // the target so a directory populated in the meantime cannot be replaced.
    assertUserDataRelocationRequest(pending)
    const targetExisted = pathEntryExists(pending.to)
    if (targetExisted) {
      await fsp.rename(pending.to, asidePath)
      asideCreated = true
      assertEmptyDirectory(asidePath, 'target changed after validation')
    }

    await fsp.mkdir(workPath)
    await writeRelocationOwner(workPath, pending.taskId)
    assertEffectiveSeparation(pending.from, workPath)

    const sourceReal = realPath(pending.from)
    const finalTargetEffective = resolveEffectivePath(pending.to)
    // Let Node own recursive copying. The filter only applies relocation-specific
    // exclusions and records links that must stop pointing at the old userData tree.
    // fsp.cp with force:false + errorOnExist:true requires that payloadPath not
    // exist — Node 24 patch releases disagree on what happens when it does
    // (24.11 silently merges, 24.14 throws ERR_FS_CP_EEXIST), so the only
    // portable contract is to let cp create its own destination. That is why
    // the payload lives one level below the marker-carrying workPath.
    const symlinks: Array<{ source: string; target: string; type: 'dir' | 'file' | 'junction' | undefined }> = []
    await fsp.cp(pending.from, payloadPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
      filter: async (source, target) => {
        const isSourceRootEntry = normalizeForCompare(path.dirname(source)) === normalizeForCompare(pending.from)
        const name = path.basename(source)
        if (isSourceRootEntry && (name.startsWith('Singleton') || name === RELOCATION_OWNER_MARKER)) return false

        let stat: Awaited<ReturnType<typeof fsp.lstat>>
        try {
          stat = await fsp.lstat(source)
        } catch (error) {
          if (isErrno(error, 'ENOENT')) {
            logger.warn('Skipping userData entry that vanished during relocation', { source })
            return false
          }
          throw error
        }
        if (!stat.isSymbolicLink()) return stat.isDirectory() || stat.isFile()

        let type: 'dir' | 'file' | 'junction' | undefined
        try {
          const followed = await fsp.stat(source)
          type = followed.isDirectory() ? (isWin ? 'junction' : 'dir') : 'file'
        } catch (error) {
          if (!isErrno(error, 'ENOENT')) throw error
          type = isWin ? 'file' : undefined
        }
        symlinks.push({ source, target, type })
        return true
      }
    })

    for (const symlink of symlinks) {
      let linkTarget: string
      try {
        linkTarget = await fsp.readlink(symlink.target)
      } catch (error) {
        if (isErrno(error, 'ENOENT')) continue
        throw error
      }
      const rewrittenTarget = await rewriteSymlinkTarget(
        symlink.source,
        linkTarget,
        symlink.type,
        sourceReal,
        finalTargetEffective
      )
      if (rewrittenTarget !== linkTarget) {
        await fsp.unlink(symlink.target)
        await fsp.symlink(rewrittenTarget, symlink.target, symlink.type)
      }
    }

    publish(makeProgress('copying', pending, total, total))

    assertEffectiveSeparation(pending.from, workPath)
    // Re-stamp the marker inside the payload before promotion: after the
    // rename the promoted target itself must carry the marker, so a launch
    // interrupted between promotion and commit can still prove ownership.
    await writeRelocationOwner(payloadPath, pending.taskId)
    await fsp.rename(payloadPath, pending.to)
    promoted = true
    await fsp.rm(path.join(workPath, RELOCATION_OWNER_MARKER), { force: true })
    await fsp.rmdir(workPath)
    commit()
  } catch (error) {
    const rollbackError = await rollbackCopy({
      target: pending.to,
      workPath,
      asidePath,
      asideCreated,
      promoted,
      taskId: pending.taskId
    })
    if (rollbackError) {
      const original = error instanceof Error ? error.message : String(error)
      throw new Error(`${original}; rollback failed: ${rollbackError.message}`)
    }
    throw error
  }

  await fsp.rm(path.join(pending.to, RELOCATION_OWNER_MARKER), { force: true }).catch((error) => {
    logger.warn('Could not remove relocation ownership marker after commit', { target: pending.to, error })
  })
  if (asideCreated) {
    // The pre-existing target was required to be empty. rmdir is deliberately
    // non-recursive so files created after the claim are never deleted.
    await fsp.rmdir(asidePath).catch((error) => {
      logger.warn('Could not remove empty relocation aside after commit; preserving it', { asidePath, error })
    })
  }
}

/**
 * Persist the new location after the filesystem transaction completed. The
 * two BootConfig writes — pin the target for this executable, clear the
 * pending request — commit together in one persist(); on persist failure the
 * in-memory state is restored before rethrowing, so a later flush cannot
 * record a path whose filesystem transaction the caller rolls back (see the
 * catch in executeRelocation).
 */
function commitUserDataRelocation(targetPath: string): void {
  const canonicalTargetPath = canonicalizeUserDataPath(targetPath)
  const exe = getNormalizedExecutablePath()
  const current = bootConfigService.get('app.user_data_path') ?? {}
  const relocation = bootConfigService.get('temp.user_data_relocation')

  bootConfigService.set('app.user_data_path', { ...current, [exe]: canonicalTargetPath })
  bootConfigService.set('temp.user_data_relocation', null)
  try {
    bootConfigService.persist()
  } catch (error) {
    bootConfigService.set('app.user_data_path', current)
    bootConfigService.set('temp.user_data_relocation', relocation)
    throw error
  }

  logger.info('userData relocation committed', { exe, targetPath: canonicalTargetPath })
}

/**
 * Startup recovery after an interrupted copy. Decision surface, in order:
 *   - owned work tree → delete it (never promoted, purely ours);
 *   - owned target → delete it (promoted but not committed, so the source
 *     is still the authoritative tree);
 *   - aside present → it holds the pre-claim target: restore it, but only
 *     while it is still empty and nothing unowned occupies the target.
 * Anything unowned is preserved and fails the relocation safely; without a
 * matching marker at most an empty directory is ever removed.
 */
async function recoverInterruptedCopy(pending: PendingRelocation): Promise<void> {
  const target = pending.to
  const { workPath, asidePath } = relocationArtifactPaths(target, pending.taskId)
  const hasWork = pathEntryExists(workPath)
  const hasAside = pathEntryExists(asidePath)
  const targetOwned = isOwnedByRelocation(target, pending.taskId)
  if (!hasWork && !hasAside && !targetOwned) return

  logger.warn('Recovering interrupted userData relocation copy', {
    taskId: pending.taskId,
    target,
    workPath,
    asidePath
  })
  if (hasWork) await removeOwnedRelocationTree(workPath, pending.taskId)
  if (targetOwned) await fsp.rm(target, { recursive: true, force: true })

  if (!hasAside) return
  assertEmptyDirectory(asidePath, 'relocation aside is no longer empty')
  if (pathEntryExists(target)) {
    invalid('target_work_conflict', `target contains unowned data during relocation recovery: ${target}`)
  }
  await fsp.rename(asidePath, target)
}

/**
 * Rollback: drop the work tree, then the promoted target (only with a
 * matching ownership marker), then restore the aside — the aside goes last
 * so it is only moved back once nothing else occupies the target. Returns
 * the rollback error instead of throwing so the caller can report the
 * original failure and the rollback failure together.
 */
async function rollbackCopy(options: {
  target: string
  workPath: string
  asidePath: string
  asideCreated: boolean
  promoted: boolean
  taskId: string
}): Promise<Error | null> {
  try {
    if (pathEntryExists(options.workPath)) {
      await removeOwnedRelocationTree(options.workPath, options.taskId)
    }
    if (options.promoted && pathEntryExists(options.target)) {
      if (!isOwnedByRelocation(options.target, options.taskId)) {
        throw new Error(`refusing to delete unowned promoted target: ${options.target}`)
      }
      await fsp.rm(options.target, { recursive: true, force: true })
    }
    if (options.asideCreated && pathEntryExists(options.asidePath)) {
      assertEmptyDirectory(options.asidePath, 'relocation aside is no longer empty')
      if (pathEntryExists(options.target)) {
        throw new Error(`cannot restore relocation aside because target exists: ${options.target}`)
      }
      await fsp.rename(options.asidePath, options.target)
    }
    return null
  } catch (error) {
    logger.error('Failed to roll back userData relocation copy', { ...options, error })
    return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Symlink policy: links resolving outside the copied tree are kept verbatim
 * (except Windows junctions, which cannot stay relative and are re-anchored
 * to their absolute resolution); links resolving inside the tree are
 * rewritten to the final target so the copy never points back into the old
 * userData. Relative in-tree links survive the whole-tree move as-is.
 */
async function rewriteSymlinkTarget(
  source: string,
  linkTarget: string,
  type: 'dir' | 'file' | 'junction' | undefined,
  sourceRootReal: string,
  finalTargetEffective: string
): Promise<string> {
  const isAbsolute = path.isAbsolute(linkTarget)
  let effectiveLinkTarget = isAbsolute ? path.resolve(linkTarget) : path.resolve(path.dirname(source), linkTarget)
  try {
    effectiveLinkTarget = await fsp.realpath(effectiveLinkTarget)
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }

  const sourceRoot = normalizeForCompare(sourceRootReal)
  const effective = normalizeForCompare(effectiveLinkTarget)
  if (effective !== sourceRoot && !isPathInside(effective, sourceRoot)) {
    return isWin && type === 'junction' ? effectiveLinkTarget : linkTarget
  }

  const relative = path.relative(sourceRoot, effective)
  const rewritten = path.join(finalTargetEffective, relative)
  if (isAbsolute || (isWin && type === 'junction')) {
    logger.info('Rewriting internal symlink during userData relocation', { source, linkTarget, rewritten })
    return rewritten
  }
  return linkTarget
}

// Symlinks count as zero bytes — the copy recreates the link itself, never
// its referent.
async function calculateTotalBytes(root: string, allowMissing = false): Promise<number> {
  let stat: Awaited<ReturnType<typeof fsp.lstat>>
  try {
    stat = await fsp.lstat(root)
  } catch (error) {
    if (allowMissing && isErrno(error, 'ENOENT')) return 0
    throw error
  }
  if (stat.isFile()) return stat.size
  if (stat.isSymbolicLink() || !stat.isDirectory()) return 0

  let entries: fs.Dirent<string>[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (allowMissing && isErrno(error, 'ENOENT')) return 0
    throw error
  }
  let total = 0
  for (const entry of entries) {
    total += await calculateTotalBytes(path.join(root, entry.name), true)
  }
  return total
}

async function assertEnoughFreeSpace(target: string, requiredBytes: number): Promise<void> {
  const { path: existingAncestor } = resolveExistingAncestor(target)
  const stats = await fsp.statfs(existingAncestor)
  const availableBytes = stats.bsize * stats.bavail
  const requiredWithSafetyMargin = Math.ceil(requiredBytes * FREE_SPACE_SAFETY_FACTOR)
  if (availableBytes < requiredWithSafetyMargin) {
    throw new Error(
      `not enough free space for relocation: required ${requiredWithSafetyMargin} including safety margin, available ${availableBytes}`
    )
  }
}

function makeProgress(
  stage: RelocationProgress['stage'],
  relocation: PendingRelocation | FailedRelocation,
  bytesCopied: number,
  bytesTotal: number,
  error?: string
): RelocationProgress {
  return {
    stage,
    from: relocation.from,
    to: relocation.to,
    copy: relocation.copy,
    bytesCopied,
    bytesTotal,
    ...(error ? { error } : {})
  }
}

async function writeRelocationOwner(directory: string, taskId: string): Promise<void> {
  await fsp.writeFile(
    path.join(directory, RELOCATION_OWNER_MARKER),
    JSON.stringify({ kind: 'cherry-studio-user-data-relocation', taskId })
  )
}

function isOwnedByRelocation(directory: string, taskId?: string): boolean {
  if (!taskId || !pathEntryExists(directory)) return false
  const marker = relocationOwnerSchema.safeParse(readJsonFile(path.join(directory, RELOCATION_OWNER_MARKER)))
  return marker.success && marker.data.taskId === taskId
}

async function removeOwnedRelocationTree(directory: string, taskId: string): Promise<void> {
  if (isOwnedByRelocation(directory, taskId)) {
    await fsp.rm(directory, { recursive: true, force: true })
    return
  }
  // Without a matching marker only an EMPTY directory may be removed — any
  // content means the tree is not ours.
  assertEmptyDirectory(directory, 'relocation artifact has no matching ownership marker')
  await fsp.rmdir(directory)
}

function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (isErrno(error, 'ENOENT') || error instanceof SyntaxError) return null
    throw error
  }
}

function clearRelocationState(): void {
  bootConfigService.set('temp.user_data_relocation', null)
  // flush(), not persist(): failing to clear must never block the relaunch.
  bootConfigService.flush()
}
