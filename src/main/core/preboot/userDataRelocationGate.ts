import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@main/core/platform'
import { commitUserDataRelocation } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { openUserDataRelocationWindow, type UserDataRelocationWindow } from '@main/services/relocationWindowService'
import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'
import type {
  RelocationProgress,
  UserDataRelocationInspection,
  UserDataRelocationValidationReason
} from '@shared/types/relocation'
import { app } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('UserDataRelocationGate')
const ACTIVE_PROFILE_MARKERS = ['SingletonLock', 'SingletonSocket'] as const
const RELOCATION_OWNER_MARKER = '.cherry-relocation-owner.json'
const FREE_SPACE_SAFETY_FACTOR = 1.2

const relocationOwnerSchema = z.object({
  kind: z.literal('cherry-studio-user-data-relocation'),
  taskId: z.string()
})

type RelocationState = NonNullable<BootConfigSchema['temp.user_data_relocation']>
type PendingRelocation = Extract<RelocationState, { status: 'pending' }>
type FailedRelocation = Extract<RelocationState, { status: 'failed' }>

export type UserDataRelocationGateResult = 'handled' | 'skipped'

class RelocationValidationError extends Error {
  constructor(
    readonly reason: UserDataRelocationValidationReason,
    message: string
  ) {
    super(message)
    this.name = 'RelocationValidationError'
  }
}

export function inspectUserDataRelocationTarget(from: string, to: string): UserDataRelocationInspection {
  try {
    const { targetExists, targetEmpty } = assertRelocationPaths(from, to)
    return { valid: true, targetExists, targetEmpty }
  } catch (error) {
    if (error instanceof RelocationValidationError) {
      return { valid: false, reason: error.reason }
    }
    throw error
  }
}

export function assertUserDataRelocationRequest(pending: PendingRelocation): void {
  const inspection = assertRelocationPaths(pending.from, pending.to, { taskId: pending.taskId })
  if (!pending.copy && !inspection.targetExists) {
    invalid('target_missing', `switch target does not exist: ${pending.to}`)
  }
  if (pending.copy && !inspection.targetEmpty) {
    invalid('target_not_empty', `copy target must be empty: ${pending.to}`)
  }
}

export async function runUserDataRelocationGate(): Promise<UserDataRelocationGateResult> {
  if (!app.isPackaged) return 'skipped'

  const relocation = bootConfigService.get('temp.user_data_relocation')
  if (!relocation) return 'skipped'

  const currentUserData = normalizeForCompare(app.getPath('userData'))
  if (normalizeForCompare(relocation.from) !== currentUserData) {
    logger.warn('Discarding stale userData relocation request', {
      requestedFrom: relocation.from,
      currentUserData: app.getPath('userData')
    })
    clearRelocationState()
    return 'skipped'
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
    bootConfigService.set('temp.user_data_relocation', {
      status: 'failed',
      taskId: relocation.taskId,
      from: relocation.from,
      to: relocation.to,
      copy: relocation.copy,
      error: message,
      failedAt: new Date().toISOString()
    })
    // The filesystem has already been rolled back. A BootConfig write failure
    // must not crash preboot before the recovery window can explain the error.
    bootConfigService.flush()
    publish(makeProgress('failed', relocation, 0, 0, message))
    if (relocationWindow.isUnavailable() || !relocationWindow.hasWindow()) restart()
  }

  return 'handled'
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
  let asideCreated = false
  let promoted = false
  let copied = 0
  let lastPercent = -1

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
    const workReal = realPath(workPath)
    const finalTargetEffective = resolveEffectivePath(pending.to)
    await copyTree(pending.from, workPath, {
      sourceRootReal: sourceReal,
      workRootReal: workReal,
      finalTargetEffective,
      onCopied: (bytes) => {
        copied += bytes
        const percent = total > 0 ? Math.floor((copied / total) * 100) : 100
        if (percent === lastPercent) return
        lastPercent = percent
        publish(makeProgress('copying', pending, copied, total))
      }
    })

    await verifyCopiedTree(pending.from, workPath)
    assertEffectiveSeparation(pending.from, workPath)
    await fsp.rename(workPath, pending.to)
    promoted = true
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

function assertRelocationPaths(
  fromValue: string,
  toValue: string,
  options: { allowRelocationArtifacts?: boolean; taskId?: string } = {}
): { targetExists: boolean; targetEmpty: boolean } {
  if (!path.isAbsolute(fromValue)) invalid('source_missing', `source must be an absolute path: ${fromValue}`)
  if (!path.isAbsolute(toValue)) invalid('target_not_absolute', `target must be an absolute path: ${toValue}`)

  const from = normalizeForCompare(fromValue)
  const to = normalizeForCompare(toValue)
  if (from === to) invalid('same_path', `source and target are the same path: ${toValue}`)
  if (isRootPath(toValue)) invalid('target_root', `target must not be a filesystem root: ${toValue}`)
  if (isPathInside(to, from)) invalid('target_inside_source', `target is inside source: ${toValue}`)
  if (isPathInside(from, to)) invalid('target_contains_source', `target contains source: ${toValue}`)

  assertDirectory(fromValue, 'source', 'source_missing')
  fs.accessSync(fromValue, fs.constants.R_OK)

  const targetExists = pathEntryExists(toValue)
  const targetAncestor = resolveExistingAncestor(toValue)
  if (!fs.statSync(targetAncestor.path).isDirectory()) {
    invalid('target_parent_unwritable', `target ancestor is not a directory: ${targetAncestor.path}`)
  }

  const fromReal = normalizeForCompare(realPath(fromValue))
  const toEffective = normalizeForCompare(targetAncestor.effectivePath)
  if (fromReal === toEffective) invalid('same_path', `source and target resolve to the same path: ${toValue}`)
  if (isPathInside(toEffective, fromReal)) {
    invalid('target_inside_source', `target real path is inside source: ${toValue}`)
  }
  if (isPathInside(fromReal, toEffective)) {
    invalid('target_contains_source', `target real path contains source: ${toValue}`)
  }

  assertTargetIsNotProtected(toValue, toEffective)
  try {
    fs.accessSync(targetExists ? toValue : targetAncestor.path, fs.constants.W_OK)
  } catch {
    invalid('target_parent_unwritable', `target is not writable: ${toValue}`)
  }

  let targetEmpty = true
  if (targetExists) {
    assertDirectory(toValue, 'target', 'target_not_directory')
    const entries = fs.readdirSync(toValue)
    targetEmpty = entries.length === 0
    if (ACTIVE_PROFILE_MARKERS.some((marker) => entries.includes(marker))) {
      invalid(
        'target_in_use',
        `target appears to be an active userData directory; close other Cherry Studio instances, or remove stale SingletonLock and SingletonSocket markers if none are running: ${toValue}`
      )
    }
  }

  if (options.taskId) {
    const { workPath, asidePath } = relocationArtifactPaths(toValue, options.taskId)
    if (!options.allowRelocationArtifacts && (pathEntryExists(workPath) || pathEntryExists(asidePath))) {
      invalid('target_work_conflict', `relocation work paths already exist beside target: ${toValue}`)
    }
  }

  return { targetExists, targetEmpty }
}

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

interface CopyContext {
  sourceRootReal: string
  workRootReal: string
  finalTargetEffective: string
  onCopied(bytes: number): void
}

async function copyTree(source: string, target: string, context: CopyContext, allowMissing = false): Promise<void> {
  let stat: Awaited<ReturnType<typeof fsp.lstat>>
  try {
    stat = await fsp.lstat(source)
  } catch (error) {
    if (allowMissing && isErrno(error, 'ENOENT')) {
      logger.warn('Skipping userData entry that vanished during relocation', { source })
      return
    }
    throw error
  }

  if (stat.isDirectory()) {
    let sourceReal: string
    try {
      sourceReal = normalizeForCompare(await fsp.realpath(source))
    } catch (error) {
      if (allowMissing && isErrno(error, 'ENOENT')) return
      throw error
    }
    const workReal = normalizeForCompare(context.workRootReal)
    if (sourceReal === workReal || isPathInside(sourceReal, workReal)) {
      throw new Error(`relocation destination became visible inside source: ${source}`)
    }

    await fsp.mkdir(target, { recursive: true })
    let entries: fs.Dirent<string>[]
    try {
      entries = await fsp.readdir(source, { withFileTypes: true })
    } catch (error) {
      if (allowMissing && isErrno(error, 'ENOENT')) return
      throw error
    }
    const isSourceRoot = sourceReal === normalizeForCompare(context.sourceRootReal)
    for (const entry of entries) {
      if (isSourceRoot && entry.name.startsWith('Singleton')) continue
      if (isSourceRoot && entry.name === RELOCATION_OWNER_MARKER) continue
      await copyTree(path.join(source, entry.name), path.join(target, entry.name), context, true)
    }
    return
  }

  if (stat.isSymbolicLink()) {
    let linkTarget: string
    try {
      linkTarget = await fsp.readlink(source)
    } catch (error) {
      if (allowMissing && isErrno(error, 'ENOENT')) return
      throw error
    }
    let type: 'dir' | 'file' | 'junction' | undefined
    try {
      const followed = await fsp.stat(source)
      type = followed.isDirectory() ? (isWin ? 'junction' : 'dir') : 'file'
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error
      type = isWin ? 'file' : undefined
    }
    const rewrittenTarget = await rewriteSymlinkTarget(
      source,
      linkTarget,
      type,
      context.sourceRootReal,
      context.finalTargetEffective
    )
    await fsp.symlink(rewrittenTarget, target, type)
    return
  }

  if (stat.isFile()) {
    try {
      await fsp.copyFile(source, target)
      context.onCopied(stat.size)
    } catch (error) {
      if (allowMissing && isErrno(error, 'ENOENT')) {
        logger.warn('Skipping userData file that vanished during relocation', { source })
        return
      }
      throw error
    }
    return
  }

  logger.warn('Skipping unsupported file system entry during userData relocation', { source })
}

async function verifyCopiedTree(source: string, target: string, isRoot = true): Promise<void> {
  let entries: fs.Dirent<string>[]
  try {
    entries = await fsp.readdir(source, { withFileTypes: true })
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return
    throw error
  }

  for (const entry of entries) {
    if (isRoot && entry.name.startsWith('Singleton')) continue
    if (isRoot && entry.name === RELOCATION_OWNER_MARKER) continue

    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    let sourceStat: Awaited<ReturnType<typeof fsp.lstat>>
    try {
      sourceStat = await fsp.lstat(sourcePath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue
      throw error
    }

    let targetStat: Awaited<ReturnType<typeof fsp.lstat>>
    try {
      targetStat = await fsp.lstat(targetPath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        throw new Error(`relocation verification failed; destination entry is missing: ${targetPath}`)
      }
      throw error
    }

    if (sourceStat.isDirectory()) {
      if (!targetStat.isDirectory()) {
        throw new Error(`relocation verification failed; destination is not a directory: ${targetPath}`)
      }
      await verifyCopiedTree(sourcePath, targetPath, false)
    } else if (sourceStat.isFile()) {
      if (!targetStat.isFile() || targetStat.size !== sourceStat.size) {
        throw new Error(`relocation verification failed; destination file size differs: ${targetPath}`)
      }
    } else if (sourceStat.isSymbolicLink() && !targetStat.isSymbolicLink()) {
      throw new Error(`relocation verification failed; destination is not a symbolic link: ${targetPath}`)
    }
  }
}

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

function assertEffectiveSeparation(source: string, target: string): void {
  const sourceReal = normalizeForCompare(realPath(source))
  const targetEffective = normalizeForCompare(resolveEffectivePath(target))
  if (sourceReal === targetEffective || isPathInside(targetEffective, sourceReal)) {
    throw new Error(`target real path is inside source: ${target}`)
  }
  if (isPathInside(sourceReal, targetEffective)) {
    throw new Error(`target real path contains source: ${target}`)
  }
}

function resolveEffectivePath(value: string): string {
  return resolveExistingAncestor(value).effectivePath
}

function resolveExistingAncestor(value: string): { path: string; effectivePath: string } {
  let cursor = path.resolve(value)
  const missingParts: string[] = []
  while (!pathEntryExists(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) {
      invalid('target_parent_unwritable', `no existing ancestor for target: ${value}`)
    }
    missingParts.unshift(path.basename(cursor))
    cursor = parent
  }
  return { path: cursor, effectivePath: path.join(realPath(cursor), ...missingParts) }
}

function realPath(value: string): string {
  return fs.realpathSync.native?.(value) ?? fs.realpathSync(value)
}

function relocationArtifactPaths(target: string, taskId: string): { workPath: string; asidePath: string } {
  const parent = path.dirname(target)
  const name = path.basename(target)
  return {
    workPath: path.join(parent, `.${name}.cherry-relocation-${taskId}-work`),
    asidePath: path.join(parent, `.${name}.cherry-relocation-${taskId}-aside`)
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
  assertEmptyDirectory(directory, 'relocation artifact has no matching ownership marker')
  await fsp.rmdir(directory)
}

function assertEmptyDirectory(directory: string, message: string): void {
  assertDirectory(directory, 'relocation artifact', 'target_work_conflict')
  if (fs.readdirSync(directory).length > 0) {
    invalid('target_work_conflict', `${message}: ${directory}`)
  }
}

function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (isErrno(error, 'ENOENT') || error instanceof SyntaxError) return null
    throw error
  }
}

function assertTargetIsNotProtected(target: string, normalizedTarget: string): void {
  const protectedApplicationTrees = [
    application.getPath('app.install'),
    application.getPath('app.root'),
    application.getPath('app.extra_resources'),
    application.getPath('cherry.home')
  ]
  for (const protectedTree of protectedApplicationTrees) {
    const normalizedProtected = normalizeForCompare(resolveEffectivePath(protectedTree))
    if (
      normalizedTarget === normalizedProtected ||
      isPathInside(normalizedTarget, normalizedProtected) ||
      isPathInside(normalizedProtected, normalizedTarget)
    ) {
      invalid('target_protected', `target overlaps a protected application or system directory: ${target}`)
    }
  }

  const systemHome = application.getPath('sys.home')
  const protectedExact = [
    systemHome,
    ...(isWin ? [path.dirname(systemHome)] : []),
    application.getPath('sys.appdata'),
    application.getPath('sys.temp'),
    application.getPath('sys.downloads'),
    application.getPath('sys.documents'),
    application.getPath('sys.desktop'),
    application.getPath('sys.music'),
    application.getPath('sys.pictures'),
    application.getPath('sys.videos')
  ]
  if (protectedExact.some((value) => normalizeForCompare(resolveEffectivePath(value)) === normalizedTarget)) {
    invalid('target_protected', `target is a protected user or system directory: ${target}`)
  }

  const resolved = path.resolve(target)
  const relative = path.relative(path.parse(resolved).root, resolved)
  const segments = relative.split(path.sep).filter(Boolean)
  const firstSegment = segments[0]?.toLowerCase()
  const isWindowsSystemVolume =
    isWin &&
    normalizeForCompare(path.parse(resolved).root) ===
      normalizeForCompare(path.parse(application.getPath('sys.appdata')).root)
  const protectedTopLevel = isWindowsSystemVolume
    ? ['windows', 'program files', 'program files (x86)', 'programdata', 'recovery', '$recycle.bin']
    : isMac
      ? ['system', 'library', 'applications', 'bin', 'sbin', 'usr', 'private']
      : isLinux
        ? ['bin', 'boot', 'dev', 'etc', 'lib', 'lib64', 'proc', 'root', 'run', 'sbin', 'sys', 'usr', 'var']
        : []
  if (segments.length === 1 && firstSegment && protectedTopLevel.includes(firstSegment)) {
    invalid('target_protected', `target is a protected operating-system directory: ${target}`)
  }
}

function assertDirectory(value: string, label: string, reason: UserDataRelocationValidationReason): void {
  try {
    if (!fs.statSync(value).isDirectory()) invalid(reason, `${label} is not a directory: ${value}`)
  } catch (error) {
    if (error instanceof RelocationValidationError) throw error
    invalid(reason, `${label} directory does not exist or is inaccessible: ${value}`)
  }
}

function pathEntryExists(value: string): boolean {
  try {
    fs.lstatSync(value)
    return true
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

function isRootPath(value: string): boolean {
  const resolved = path.resolve(value)
  return normalizeForCompare(resolved) === normalizeForCompare(path.parse(resolved).root)
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return isWin || isMac ? resolved.toLowerCase() : resolved
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function clearRelocationState(): void {
  bootConfigService.set('temp.user_data_relocation', null)
  bootConfigService.flush()
}

function invalid(reason: UserDataRelocationValidationReason, message: string): never {
  throw new RelocationValidationError(reason, message)
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
