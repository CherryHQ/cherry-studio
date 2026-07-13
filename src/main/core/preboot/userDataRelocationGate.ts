import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
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

const logger = loggerService.withContext('UserDataRelocationGate')
const ACTIVE_PROFILE_MARKERS = ['SingletonLock', 'SingletonSocket'] as const

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
    return { valid: true, ...assertRelocationPaths(from, to) }
  } catch (error) {
    if (error instanceof RelocationValidationError) {
      return { valid: false, reason: error.reason }
    }
    throw error
  }
}

export function assertUserDataRelocationRequest(pending: PendingRelocation): void {
  const inspection = assertRelocationPaths(pending.from, pending.to)
  if (!pending.copy && !inspection.targetExists) {
    invalid('target_missing', `switch target does not exist: ${pending.to}`)
  }
  if (pending.copy && !inspection.targetEmpty && !pending.overwrite) {
    invalid('target_not_empty', `target directory is not empty: ${pending.to}`)
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
    relocationWindow.close()
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
      from: relocation.from,
      to: relocation.to,
      copy: relocation.copy,
      overwrite: relocation.overwrite,
      error: message,
      failedAt: new Date().toISOString()
    })
    bootConfigService.persist()
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
    assertRelocationPaths(pending.from, pending.to, { allowRelocationArtifacts: true })
    await recoverInterruptedCopy(pending.to)
  }
  assertUserDataRelocationRequest(pending)

  if (!pending.copy) {
    commit()
    return
  }

  const total = await calculateTotalBytes(pending.from)
  await assertEnoughFreeSpace(pending.to, total)
  publish(makeProgress('copying', pending, 0, total))

  const { workPath, asidePath } = relocationArtifactPaths(pending.to)
  const targetExisted = pathEntryExists(pending.to)
  let asideCreated = false
  let promoted = false
  let copied = 0
  let lastPercent = -1

  try {
    if (targetExisted) {
      await fsp.rename(pending.to, asidePath)
      asideCreated = true
    }

    await fsp.mkdir(workPath, { recursive: true })
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
      promoted
    })
    if (rollbackError) {
      const original = error instanceof Error ? error.message : String(error)
      throw new Error(`${original}; rollback failed: ${rollbackError.message}`)
    }
    throw error
  }

  if (asideCreated) {
    await fsp.rm(asidePath, { recursive: true, force: true }).catch((error) => {
      logger.warn('Could not remove previous relocation target after commit', { asidePath, error })
    })
  }
}

function assertRelocationPaths(
  fromValue: string,
  toValue: string,
  options: { allowRelocationArtifacts?: boolean } = {}
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
  try {
    fs.accessSync(targetExists ? toValue : targetAncestor.path, fs.constants.W_OK)
  } catch {
    invalid('target_parent_unwritable', `target is not writable: ${toValue}`)
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

  const installEffective = normalizeForCompare(resolveEffectivePath(application.getPath('app.install')))
  if (toEffective === installEffective || isPathInside(toEffective, installEffective)) {
    invalid('target_inside_install', `target must not be inside the app install path: ${toValue}`)
  }

  let targetEmpty = true
  if (targetExists) {
    assertDirectory(toValue, 'target', 'target_not_directory')
    const entries = fs.readdirSync(toValue)
    targetEmpty = entries.length === 0
    if (isTopLevelPath(toValue) && !targetEmpty) {
      invalid('target_top_level_not_empty', `top-level target directory is not empty: ${toValue}`)
    }
    if (ACTIVE_PROFILE_MARKERS.some((marker) => entries.includes(marker))) {
      invalid(
        'target_in_use',
        `target appears to be an active userData directory; close other Cherry Studio instances, or remove stale SingletonLock and SingletonSocket markers if none are running: ${toValue}`
      )
    }
  }

  const { workPath, asidePath } = relocationArtifactPaths(toValue)
  if (!options.allowRelocationArtifacts && (pathEntryExists(workPath) || pathEntryExists(asidePath))) {
    invalid('target_work_conflict', `relocation work paths already exist beside target: ${toValue}`)
  }

  return { targetExists, targetEmpty }
}

async function recoverInterruptedCopy(target: string): Promise<void> {
  const { workPath, asidePath } = relocationArtifactPaths(target)
  const hasWork = pathEntryExists(workPath)
  const hasAside = pathEntryExists(asidePath)
  if (!hasWork && !hasAside) return

  logger.warn('Recovering interrupted userData relocation copy', { target, workPath, asidePath })
  if (hasWork) await fsp.rm(workPath, { recursive: true, force: true })
  if (!hasAside) return

  if (pathEntryExists(target)) {
    const entries = fs.statSync(target).isDirectory() ? fs.readdirSync(target) : []
    if (ACTIVE_PROFILE_MARKERS.some((marker) => entries.includes(marker))) {
      invalid(
        'target_in_use',
        `target became active during relocation recovery; close other Cherry Studio instances, or remove stale SingletonLock and SingletonSocket markers if none are running: ${target}`
      )
    }
    await fsp.rm(target, { recursive: true, force: true })
  }
  await fsp.rename(asidePath, target)
}

async function rollbackCopy(options: {
  target: string
  workPath: string
  asidePath: string
  asideCreated: boolean
  promoted: boolean
}): Promise<Error | null> {
  try {
    await fsp.rm(options.workPath, { recursive: true, force: true })
    if (options.promoted && pathEntryExists(options.target)) {
      await fsp.rm(options.target, { recursive: true, force: true })
    }
    if (options.asideCreated && pathEntryExists(options.asidePath)) {
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
  if (availableBytes < requiredBytes) {
    throw new Error(`not enough free space for relocation: required ${requiredBytes}, available ${availableBytes}`)
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

function relocationArtifactPaths(target: string): { workPath: string; asidePath: string } {
  const parent = path.dirname(target)
  const name = path.basename(target)
  return {
    workPath: path.join(parent, `.${name}.cherry-relocation-work`),
    asidePath: path.join(parent, `.${name}.cherry-relocation-aside`)
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

function isTopLevelPath(value: string): boolean {
  const resolved = path.resolve(value)
  const relative = path.relative(path.parse(resolved).root, resolved)
  return relative.split(path.sep).filter(Boolean).length === 1
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return isWin ? resolved.toLowerCase() : resolved
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function clearRelocationState(): void {
  bootConfigService.set('temp.user_data_relocation', null)
  bootConfigService.persist()
}

function invalid(reason: UserDataRelocationValidationReason, message: string): never {
  throw new RelocationValidationError(reason, message)
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
