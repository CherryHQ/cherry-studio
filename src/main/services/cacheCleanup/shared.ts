import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { CacheCleanupGroup, CacheCleanupSizeAccuracy } from '@shared/types/cacheCleanup'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'

const logger = loggerService.withContext('CacheCleanup')

export type CacheCleanupIssueCode = 'inspection_failed' | 'unsafe_target' | 'invalid_data'

export interface CacheCleanupIssue {
  item: string
  code: CacheCleanupIssueCode
}

export interface SizeMeasurement {
  bytes: number
  issues: CacheCleanupIssue[]
}

export interface CleanupTarget {
  item: string
  path: string
  kind: 'file' | 'directory'
}

export interface CleanupStepResult {
  state: 'cleared' | 'not_found' | 'skipped' | 'failed'
}

export function issue(item: string, code: CacheCleanupIssueCode): CacheCleanupIssue {
  return { item, code }
}

export function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function isPathWithin(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return (
    relativePath === '' ||
    (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`))
  )
}

async function pathContainsActiveUserData(targetPath: string): Promise<boolean> {
  const activeUserData = application.getPath('app.userdata')
  if (isPathWithin(activeUserData, targetPath)) return true

  const [realTarget, realActiveUserData] = await Promise.all([fs.realpath(targetPath), fs.realpath(activeUserData)])
  return isPathWithin(realActiveUserData, realTarget)
}

async function pathHasSymlinkedOwnedSegment(targetPath: string): Promise<boolean> {
  const trustedRoots = [application.getPath('app.userdata'), application.getPath('cherry.home')]
    .filter((rootPath) => isPathWithin(targetPath, rootPath))
    .sort((left, right) => right.length - left.length)
  const trustedRoot = trustedRoots[0]
  if (!trustedRoot) return true

  const relativePath = path.relative(path.resolve(trustedRoot), path.resolve(targetPath))
  let currentPath = trustedRoot
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment)
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) return true
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false
      throw error
    }
  }
  return false
}

async function measurePath(
  targetPath: string,
  item: string,
  excludedPaths: ReadonlySet<string> = new Set(),
  nested = false,
  signal?: AbortSignal
): Promise<SizeMeasurement> {
  signal?.throwIfAborted()
  const resolvedPath = path.resolve(targetPath)
  if (excludedPaths.has(resolvedPath)) {
    return { bytes: 0, issues: [] }
  }

  let stats
  try {
    stats = await fs.lstat(targetPath)
  } catch (error) {
    signal?.throwIfAborted()
    if (isNodeError(error, 'ENOENT')) {
      return { bytes: 0, issues: [] }
    }
    logger.warn('Failed to inspect cleanup target size', { item, path: targetPath, error })
    return { bytes: 0, issues: [issue(item, 'inspection_failed')] }
  }
  signal?.throwIfAborted()

  if (stats.isSymbolicLink()) {
    if (!nested) {
      logger.warn('Skipped symbolic-link cleanup target', { item, path: targetPath })
      return { bytes: 0, issues: [issue(item, 'unsafe_target')] }
    }
    return { bytes: stats.size, issues: [] }
  }

  if (!stats.isDirectory()) {
    return { bytes: stats.size, issues: [] }
  }

  let entries
  try {
    entries = await fs.readdir(targetPath)
  } catch (error) {
    signal?.throwIfAborted()
    logger.warn('Failed to read cleanup target directory', { item, path: targetPath, error })
    return { bytes: 0, issues: [issue(item, 'inspection_failed')] }
  }
  signal?.throwIfAborted()

  const result: SizeMeasurement = { bytes: 0, issues: [] }
  for (const entry of entries) {
    const child = await measurePath(path.join(targetPath, entry), item, excludedPaths, true, signal)
    result.bytes += child.bytes
    result.issues.push(...child.issues)
  }
  return result
}

export function mergeMeasurements(measurements: SizeMeasurement[]): SizeMeasurement {
  const result: SizeMeasurement = { bytes: 0, issues: [] }
  for (const measurement of measurements) {
    result.bytes += measurement.bytes
    result.issues.push(...measurement.issues)
  }
  return result
}

export function toSizeSnapshot(
  measurement: SizeMeasurement,
  accuracy: CacheCleanupSizeAccuracy
): CacheCleanupSizeSnapshot {
  const partial = measurement.issues.length > 0
  const allUnavailable = partial && measurement.bytes === 0
  return {
    bytes: allUnavailable ? null : measurement.bytes,
    accuracy: allUnavailable ? 'unavailable' : accuracy,
    completeness: partial ? 'partial' : 'complete'
  }
}

export async function measurePaths(
  targets: ReadonlyArray<{ item: string; path: string; excludedPaths?: ReadonlySet<string> }>,
  signal?: AbortSignal
): Promise<SizeMeasurement> {
  const uniqueTargets = new Map<string, (typeof targets)[number]>()
  for (const target of targets) {
    const resolvedPath = path.resolve(target.path)
    if (!uniqueTargets.has(resolvedPath)) {
      uniqueTargets.set(resolvedPath, target)
    }
  }

  return mergeMeasurements(
    await Promise.all(
      [...uniqueTargets.values()].map(({ item, path: targetPath, excludedPaths }) =>
        measurePath(targetPath, item, excludedPaths, false, signal)
      )
    )
  )
}

export async function inspectTarget(
  targetPath: string,
  item: string,
  kind: CleanupTarget['kind']
): Promise<'missing' | 'valid' | 'invalid'> {
  try {
    if (await pathHasSymlinkedOwnedSegment(targetPath)) {
      logger.warn('Cleanup target contains a symbolic-link path segment', { item, path: targetPath })
      return 'invalid'
    }
    const stats = await fs.lstat(targetPath)
    const hasExpectedType = kind === 'file' ? stats.isFile() : stats.isDirectory()
    if (stats.isSymbolicLink() || !hasExpectedType) {
      logger.warn('Cleanup target has an unexpected type', { item, path: targetPath, kind })
      return 'invalid'
    }
    if (await pathContainsActiveUserData(targetPath)) {
      logger.warn('Cleanup target contains the active userData directory', { item, path: targetPath })
      return 'invalid'
    }
    return 'valid'
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return 'missing'
    logger.warn('Failed to inspect cleanup target', { item, path: targetPath, kind, error })
    return 'invalid'
  }
}

export async function collectOwnedTargets<T extends CleanupTarget>(
  candidates: readonly T[]
): Promise<{ targets: T[]; issues: CacheCleanupIssue[] }> {
  const inspected = await Promise.all(
    candidates.map(async (target) => ({ target, status: await inspectTarget(target.path, target.item, target.kind) }))
  )
  return {
    targets: inspected.filter(({ status }) => status === 'valid').map(({ target }) => target),
    issues: inspected
      .filter(({ status }) => status === 'invalid')
      .map(({ target }) => issue(target.item, 'unsafe_target'))
  }
}

export async function captureStep(item: string, operation: () => Promise<void>): Promise<CleanupStepResult> {
  try {
    await operation()
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Cache cleanup operation failed', { item, error })
    return { state: 'failed' }
  }
}

export function resultFromSteps(group: CacheCleanupGroup, steps: CleanupStepResult[]): CacheCleanupGroupResult {
  const succeeded = steps.some(({ state }) => state === 'cleared' || state === 'not_found')
  const hasState = (state: CleanupStepResult['state']) => steps.some((step) => step.state === state)

  if (hasState('failed')) return { group, status: succeeded || hasState('skipped') ? 'partial' : 'failed' }
  if (hasState('skipped')) return { group, status: succeeded ? 'partial' : 'skipped' }
  return { group, status: hasState('cleared') ? 'cleared' : 'not_found' }
}

export async function removeCleanupTarget(target: CleanupTarget): Promise<CleanupStepResult> {
  const status = await inspectTarget(target.path, target.item, target.kind)
  if (status === 'missing') return { state: 'not_found' }
  if (status === 'invalid') return { state: 'skipped' }

  try {
    await fs.rm(target.path, { recursive: target.kind === 'directory', force: false })
    logger.info('Removed cleanup target', { item: target.item, path: target.path })
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Failed to remove cleanup target', { item: target.item, path: target.path, error })
    return { state: 'failed' }
  }
}
