/**
 * Owner-scoped resource capture.
 *
 * The detached main database says which managed units matter. Each unit then
 * obtains its own consistent cut; there is deliberately no profile-wide file
 * baseline and no requirement that unrelated background computation stop.
 */

import fs from 'node:fs'
import { mkdir, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { isSafeRelativeSubpath } from '@main/utils/relativePath'

import { RESOURCES_PREFIX } from '../archiveLayout'
import { BACKUP_CEILINGS, FIXED_ARCHIVE_ENTRIES } from '../ceilings'
import {
  BackupCancelledError,
  CeilingExceededError,
  DiskFullError,
  NonRegularSourceError,
  SourceDriftError,
  UnportableSourceError
} from '../errors'
import { hashDirectoryUnit, sha256FileCancellable } from '../hashing'
import {
  type BackupManifestDegradation,
  type ResourceDegradationReason,
  type ResourcePayload,
  type ResourceRequirement
} from '../manifest'
import { validateResourcePathSet } from '../resourcePaths'
import { stageDirectoryWithDriftCheck, stageFileWithDriftCheck, stagePartialDirectoryTree } from '../sourceDrift'
import {
  captureModeForKind,
  capturePolicyForKind,
  type ResourceCaptureMode,
  type ResourceRoots,
  type UnitContentRequirement
} from './adapters'
import { carriesRequiredContent } from './contentProof'

const logger = loggerService.withContext('backupStageResources')

export interface OwnerCaptureDegradation {
  readonly reason: ResourceDegradationReason
  /** Unit-relative path. Omit for a whole-unit owner result. */
  readonly relativePath?: string
}

export interface OwnerCaptureContext {
  readonly requirement: ResourceRequirement
  readonly sourcePath: string
  readonly stagingPath: string
  readonly mode: ResourceCaptureMode
  readonly signal?: AbortSignal
}

/**
 * Fixed owner dispatch supplied by the export orchestrator. It may add a
 * verified owner snapshot inside an already-staged unit, or materialize a whole
 * `owner-snapshot` unit. Expected owner fallback is returned as degradation;
 * archive/staging integrity failures are thrown.
 */
export type CaptureOwnerResource = (
  context: OwnerCaptureContext
) => Promise<{ readonly degradations?: readonly OwnerCaptureDegradation[] }>

export type RunOwnerCaptureBoundary = <T>(
  context: Pick<OwnerCaptureContext, 'requirement' | 'sourcePath' | 'mode' | 'signal'>,
  capture: () => Promise<T>
) => Promise<T>

export interface StageResourcesInput {
  readonly requirements: readonly ResourceRequirement[]
  readonly userDataPath: string
  readonly resourcesDir: string
  readonly requiredContent?: ReadonlyMap<string, UnitContentRequirement>
  readonly roots?: ResourceRoots
  readonly captureOwnerResource?: CaptureOwnerResource
  readonly runOwnerCaptureBoundary?: RunOwnerCaptureBoundary
  readonly signal?: AbortSignal
}

export interface StagedResources {
  readonly payloads: readonly ResourcePayload[]
  readonly degradations: readonly BackupManifestDegradation[]
  readonly staged: boolean
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError('backup export cancelled')
}

function absoluteOf(userDataPath: string, livePath: string): string {
  return path.resolve(userDataPath, ...livePath.split('/'))
}

function assertRequirementSet(requirements: readonly ResourceRequirement[]): void {
  if (requirements.length > BACKUP_CEILINGS.maxResourceInstallEntries) {
    throw new CeilingExceededError(
      'resource-entries',
      `${requirements.length} > ${BACKUP_CEILINGS.maxResourceInstallEntries}`
    )
  }
  const pathSet = validateResourcePathSet(requirements.map((requirement) => requirement.livePath))
  if (!pathSet.ok) throw new Error(`resource payloads are not a legal install set: ${pathSet.violation.code}`)
}

function sourceRootDegradation(
  sourcePath: string,
  requirement: ResourceRequirement,
  error?: unknown
): ResourceDegradationReason | undefined {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(sourcePath)
  } catch (probeError) {
    const code = (probeError as NodeJS.ErrnoException).code ?? (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent-at-snapshot'
    if (code === 'EACCES' || code === 'EPERM') return 'unclassified-reference'
    return undefined
  }
  if (stats.isSymbolicLink()) return 'external-reference'
  if (requirement.resourceType === 'file' ? stats.isFile() : stats.isDirectory()) return undefined
  if (!stats.isFile() && !stats.isDirectory()) return 'unclassified-reference'
  return 'type-mismatch-at-snapshot'
}

function sourceFailureDegradation(
  sourcePath: string,
  requirement: ResourceRequirement,
  error: unknown
): ResourceDegradationReason | undefined {
  const root = sourceRootDegradation(sourcePath, requirement, error)
  if (root) return root
  if (error instanceof SourceDriftError) return 'changed-during-capture'
  if (error instanceof NonRegularSourceError) return 'non-regular-source'
  if (error instanceof UnportableSourceError) return 'unportable-source'
  if (error instanceof CeilingExceededError) return 'resource-ceiling-exceeded'
  if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'unclassified-reference'
  return undefined
}

function entryDegradation(
  requirement: ResourceRequirement,
  relativePath: string | undefined,
  reason: ResourceDegradationReason
): BackupManifestDegradation {
  if (relativePath) {
    const livePath = `${requirement.livePath}/${relativePath}`
    return {
      kind: `resource-entry:${requirement.kind}`,
      reason,
      ...(isSafeRelativeSubpath(livePath) ? { livePath } : {})
    }
  }
  return { kind: `resource:${requirement.kind}`, livePath: requirement.livePath, reason }
}

async function removeStagedUnit(stagingPath: string, resourcesDir: string): Promise<void> {
  await rm(stagingPath, { recursive: true, force: true })
  await removeEmptyStagingAncestors(stagingPath, resourcesDir)
}

async function captureStrictUnit(input: {
  requirement: ResourceRequirement
  sourcePath: string
  stagingPath: string
  roots?: ResourceRoots
  signal?: AbortSignal
}): Promise<{
  readonly contentPaths: readonly string[]
  readonly degradations: readonly OwnerCaptureDegradation[]
}> {
  const { requirement, sourcePath, stagingPath, roots, signal } = input
  const capturePolicy = capturePolicyForKind(requirement.kind, roots)
  const maxAttempts = captureModeForKind(requirement.kind).kind === 'strict-unit' ? 2 : 1
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(signal)
    try {
      if (requirement.resourceType === 'file') {
        await stageFileWithDriftCheck({ sourcePath, stagingPath, signal })
        return { contentPaths: [], degradations: [] }
      }

      await mkdir(path.dirname(stagingPath), { recursive: true, mode: 0o700 })
      const staged = await stageDirectoryWithDriftCheck({
        sourceDir: sourcePath,
        stagingDir: stagingPath,
        signal,
        capturePolicy
      })
      return {
        contentPaths: staged.files.map((file) => file.relPath),
        degradations: staged.scan.omissions.map((omission) => ({
          relativePath: omission.relPath,
          reason: omission.reason
        }))
      }
    } catch (error) {
      if (error instanceof BackupCancelledError || error instanceof DiskFullError) throw error
      lastError = error
      await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
      if (!(error instanceof SourceDriftError) || attempt === maxAttempts) throw error
    }
  }
  throw lastError
}

async function capturePartialTree(input: {
  requirement: ResourceRequirement
  sourcePath: string
  stagingPath: string
  roots?: ResourceRoots
  signal?: AbortSignal
}): Promise<{
  readonly contentPaths: readonly string[]
  readonly degradations: readonly OwnerCaptureDegradation[]
}> {
  const { requirement, sourcePath, stagingPath, roots, signal } = input
  if (requirement.resourceType !== 'directory') {
    throw new Error(`partial-tree capture requires a directory: ${requirement.livePath}`)
  }
  const capturePolicy = capturePolicyForKind(requirement.kind, roots)
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    throwIfAborted(signal)
    try {
      await mkdir(path.dirname(stagingPath), { recursive: true, mode: 0o700 })
      const staged = await stagePartialDirectoryTree({
        sourceDir: sourcePath,
        stagingDir: stagingPath,
        signal,
        capturePolicy
      })
      return {
        contentPaths: staged.files.map((file) => file.relPath),
        degradations: staged.omissions.map((omission) => ({
          relativePath: omission.relPath,
          reason: omission.reason
        }))
      }
    } catch (error) {
      if (error instanceof BackupCancelledError || error instanceof DiskFullError) throw error
      lastError = error
      await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
      if (!(error instanceof SourceDriftError) || attempt === 2) throw error
    }
  }
  throw lastError
}

export async function stageResources(input: StageResourcesInput): Promise<StagedResources> {
  const {
    requirements,
    userDataPath,
    resourcesDir,
    requiredContent,
    roots,
    captureOwnerResource,
    runOwnerCaptureBoundary,
    signal
  } = input
  throwIfAborted(signal)
  assertRequirementSet(requirements)

  const payloads: ResourcePayload[] = []
  const degradations: BackupManifestDegradation[] = []
  let archiveEntries = FIXED_ARCHIVE_ENTRIES
  let archiveBytes = 0

  for (const requirement of requirements) {
    throwIfAborted(signal)
    const sourcePath = absoluteOf(userDataPath, requirement.livePath)
    const stagingPath = path.join(resourcesDir, ...requirement.livePath.split('/'))
    const mode = captureModeForKind(requirement.kind)
    const unavailable = sourceRootDegradation(sourcePath, requirement)
    if (unavailable && mode.kind !== 'owner-snapshot') {
      degradations.push(entryDegradation(requirement, undefined, unavailable))
      continue
    }

    try {
      const capture = async () => {
        let captured:
          | {
              readonly contentPaths: readonly string[]
              readonly degradations: readonly OwnerCaptureDegradation[]
            }
          | undefined
        if (mode.kind === 'strict-unit') {
          captured = await captureStrictUnit({ requirement, sourcePath, stagingPath, roots, signal })
        } else if (mode.kind === 'partial-tree') {
          captured = await capturePartialTree({ requirement, sourcePath, stagingPath, roots, signal })
        } else {
          await mkdir(path.dirname(stagingPath), { recursive: true, mode: 0o700 })
        }

        if (!carriesRequiredContent(captured?.contentPaths ?? [], requiredContent?.get(requirement.livePath))) {
          return { status: 'unrebuildable' as const, degradations: [] }
        }

        const ownerResult = await captureOwnerResource?.({
          requirement,
          sourcePath,
          stagingPath,
          mode,
          signal
        })
        return {
          status: 'captured' as const,
          degradations: [...(captured?.degradations ?? []), ...(ownerResult?.degradations ?? [])]
        }
      }
      const boundaryContext = { requirement, sourcePath, mode, signal }
      const captured = runOwnerCaptureBoundary
        ? await runOwnerCaptureBoundary(boundaryContext, capture)
        : await capture()
      if (captured.status === 'unrebuildable') {
        await removeStagedUnit(stagingPath, resourcesDir)
        degradations.push(entryDegradation(requirement, undefined, 'unrebuildable-content'))
        continue
      }
      const unitDegradations = captured.degradations

      const common = {
        kind: requirement.kind,
        archivePath: `${RESOURCES_PREFIX}${requirement.livePath}`,
        livePath: requirement.livePath
      }
      let payload: ResourcePayload
      let entryCount: number
      if (requirement.resourceType === 'file') {
        const staged = await fs.promises.lstat(stagingPath)
        if (!staged.isFile() || staged.isSymbolicLink()) {
          throw new Error(`owner capture did not materialize a regular file: ${requirement.livePath}`)
        }
        payload = {
          ...common,
          resourceType: 'file',
          hash: await sha256FileCancellable(stagingPath, signal),
          sizeBytes: staged.size,
          executable: (staged.mode & 0o111) !== 0
        }
        entryCount = 1
      } else {
        const staged = await hashDirectoryUnit(stagingPath, { signal })
        payload = {
          ...common,
          resourceType: 'directory',
          hash: staged.hash,
          sizeBytes: staged.files.reduce((sum, file) => sum + file.size, 0)
        }
        entryCount = staged.entryCount
      }

      if (
        archiveEntries + entryCount > BACKUP_CEILINGS.maxArchiveEntries ||
        archiveBytes + payload.sizeBytes > BACKUP_CEILINGS.maxTotalUncompressedBytes
      ) {
        await removeStagedUnit(stagingPath, resourcesDir)
        degradations.push(entryDegradation(requirement, undefined, 'resource-ceiling-exceeded'))
        continue
      }
      archiveEntries += entryCount
      archiveBytes += payload.sizeBytes
      payloads.push(payload)
      degradations.push(
        ...unitDegradations.map((degradation) =>
          entryDegradation(requirement, degradation.relativePath, degradation.reason)
        )
      )
    } catch (error) {
      await removeStagedUnit(stagingPath, resourcesDir).catch((cleanupError) => {
        logger.warn('Could not remove failed resource staging unit', cleanupError as Error, {
          livePath: requirement.livePath
        })
      })
      if (error instanceof BackupCancelledError || error instanceof DiskFullError) throw error
      // An owner-snapshot is the only portable representation of its live
      // state (for example an Agent resume transcript). Publishing the DB
      // reference without that snapshot would create a dangling active token,
      // so ordinary source-degradation fallback is not valid for this mode.
      if (mode.kind === 'owner-snapshot') throw error
      const reason = sourceFailureDegradation(sourcePath, requirement, error)
      if (reason) {
        degradations.push(entryDegradation(requirement, undefined, reason))
        continue
      }
      throw error
    }
  }

  logger.info('Staged Full resource payloads', {
    payloads: payloads.length,
    degraded: degradations.length,
    bytes: archiveBytes
  })
  return { payloads, degradations, staged: payloads.length > 0 }
}

async function removeEmptyStagingAncestors(stagingPath: string, resourcesDir: string): Promise<void> {
  const root = path.resolve(resourcesDir)
  let current = path.dirname(path.resolve(stagingPath))
  const relative = path.relative(root, current)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`resource staging path escaped its owned root: ${stagingPath}`)
  }

  while (current !== root) {
    try {
      await rmdir(current)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        current = path.dirname(current)
        continue
      }
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return
      throw error
    }
    current = path.dirname(current)
  }
}
