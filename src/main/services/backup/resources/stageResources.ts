/**
 * Full-preset resource staging (docs/references/backup/README.md §1.7, §5.4).
 *
 * Turns the requirement inventory — what the exported database SAYS it needs —
 * into the payload inventory the archive actually carries. Each unit is copied
 * into the operation-owned staging tree through the shared drift-checked stagers,
 * so the archive can name the exact bytes it captured.
 *
 * The two failure modes are deliberately different (§1.7):
 *
 * - **Already not there at snapshot time** — absent, or a node that is not the
 *   declared kind (a symlink or a file where a managed directory belongs) — is a
 *   DEGRADATION. The profile is what it is; refusing to back up the other 5,000
 *   attachments because one is gone would leave the user with no backup at all.
 *   The "not the declared kind" reading matches `coverage.ts` on the restoring
 *   side, so both ends of a restore classify the same node identically.
 * - **Changing after the snapshot boundary** omits the complete unit, because
 *   the archive could no longer prove which version it holds. That judgement
 *   lives in `sourceDrift.ts`; this module records the bounded exclusion and
 *   continues with other units.
 *
 * A payload's `archivePath` is its `livePath` under `resources/`, so the archive
 * mirrors the layout it will be installed into and payload distinctness follows
 * from destination distinctness — which is checked here, with the same collision
 * rules admission will re-apply.
 */

import fs from 'node:fs'
import { lstat, mkdir, rmdir } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

import { RESOURCES_PREFIX } from '../archiveLayout'
import { BACKUP_CEILINGS } from '../ceilings'
import { type DirScanResult, type FsIdentity, fsIdentityOf, scanDirectoryUnit } from '../dirScan'
import {
  BackupCancelledError,
  CeilingExceededError,
  NonRegularSourceError,
  SourceDriftError,
  UnportableSourceError
} from '../errors'
import { hashDirectoryUnit } from '../hashing'
import {
  type BackupManifestDegradation,
  type ResourceDegradationReason,
  type ResourcePayload,
  type ResourceRequirement
} from '../manifest'
import { validateResourcePathSet } from '../resourcePaths'
import { stageDirectoryWithDriftCheck, stageFileWithDriftCheck } from '../sourceDrift'

const logger = loggerService.withContext('backupStageResources')

/** Deterministic seam for source changes between root inspection and directory scanning. */
export const stageResourceHooks = {
  async afterBaselineInspect(sourcePath: string): Promise<void> {
    void sourcePath
  }
}

/** Kinds whose unit root carries a rebuildable index that export excludes (§6.7). */
const KNOWLEDGE_KIND = 'knowledge-base'

export interface StageResourcesInput {
  /** The inventory the exported database produced; every entry is a candidate payload. */
  readonly requirements: readonly ResourceRequirement[]
  /** Producer userData root that each `livePath` is relative to. */
  readonly userDataPath: string
  /** Operation-owned directory the payloads are staged under (`resources/` in the archive). */
  readonly resourcesDir: string
  /** Baseline captured while cross-store profile mutations were frozen. */
  readonly baseline?: ResourceStageBaseline
  readonly signal?: AbortSignal
}

export interface StagedResources {
  readonly payloads: readonly ResourcePayload[]
  /** One entry per requirement this profile could not supply, for the manifest (§1.7). */
  readonly degradations: readonly BackupManifestDegradation[]
  /** True when at least one payload was staged, i.e. `resourcesDir` now has content. */
  readonly staged: boolean
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError('backup export cancelled')
}

function absoluteOf(userDataPath: string, livePath: string): string {
  return path.resolve(userDataPath, ...livePath.split('/'))
}

/**
 * Snapshot-time classification of one declared source. Anything other than a
 * real node of the declared type is "not here", with the reason kept for the
 * manifest so a degraded archive can never look complete.
 */
type SourceInspection =
  | { readonly kind: 'present'; readonly stats: fs.BigIntStats }
  | { readonly kind: 'excluded'; readonly reason: ResourceDegradationReason }

export type ResourceUnitBaseline =
  | { readonly kind: 'excluded'; readonly reason: ResourceDegradationReason }
  | { readonly kind: 'file'; readonly identity: FsIdentity; readonly sizeBytes: bigint }
  | { readonly kind: 'directory'; readonly scan: DirScanResult }

export interface ResourceStageBaseline {
  readonly units: ReadonlyMap<string, ResourceUnitBaseline>
  readonly totalBytes: number
}

function inspectSource(sourcePath: string, requirement: ResourceRequirement): SourceInspection {
  let stats: fs.BigIntStats
  try {
    stats = fs.lstatSync(sourcePath, { bigint: true })
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return { kind: 'excluded', reason: 'absent-at-snapshot' }
    }
    throw error
  }
  if (requirement.resourceType === 'file' ? stats.isFile() : stats.isDirectory()) {
    return { kind: 'present', stats }
  }
  return { kind: 'excluded', reason: 'type-mismatch-at-snapshot' }
}

function assertRequirementSet(requirements: readonly ResourceRequirement[]): void {
  if (requirements.length > BACKUP_CEILINGS.maxResourceInstallEntries) {
    // Producing it would produce an archive no device could restore: the journal
    // schema and admission both cap install entries at the same number.
    throw new CeilingExceededError(
      'resource-entries',
      `${requirements.length} > ${BACKUP_CEILINGS.maxResourceInstallEntries}`
    )
  }

  const pathSet = validateResourcePathSet(requirements.map((requirement) => requirement.livePath))
  if (!pathSet.ok) {
    throw new Error(`resource payloads are not a legal install set: ${pathSet.violation.code}`)
  }
}

/**
 * Size the exact resource requirement set before copying it into staging.
 * Missing/type-mismatched units contribute no bytes, matching stageResources'
 * degradation rule; directory scans also apply the normal portability and
 * ceiling checks. A later drift can still fail closed, but ordinary Full work is
 * preflighted before its first resource copy.
 */
export async function captureResourceStageBaseline(
  input: Omit<StageResourcesInput, 'resourcesDir' | 'baseline'>
): Promise<ResourceStageBaseline> {
  const { requirements, userDataPath, signal } = input
  throwIfAborted(signal)
  assertRequirementSet(requirements)

  const units = new Map<string, ResourceUnitBaseline>()
  let total = 0n
  for (const requirement of requirements) {
    throwIfAborted(signal)
    const sourcePath = absoluteOf(userDataPath, requirement.livePath)
    const inspected = inspectSource(sourcePath, requirement)
    if (inspected.kind === 'excluded') {
      units.set(requirement.livePath, inspected)
      continue
    }
    await stageResourceHooks.afterBaselineInspect(sourcePath)

    if (requirement.resourceType === 'file') {
      const sizeBytes = inspected.stats.size
      if (sizeBytes > BigInt(BACKUP_CEILINGS.maxEntryUncompressedBytes)) {
        units.set(requirement.livePath, { kind: 'excluded', reason: 'resource-ceiling-exceeded' })
        continue
      }
      total += sizeBytes
      units.set(requirement.livePath, {
        kind: 'file',
        identity: fsIdentityOf(inspected.stats, 'file'),
        sizeBytes
      })
    } else {
      let scan: DirScanResult
      try {
        scan = await scanDirectoryUnit(sourcePath, {
          signal,
          excludeKnowledgeDerivedIndex: requirement.kind === KNOWLEDGE_KIND
        })
      } catch (error) {
        if (error instanceof NonRegularSourceError) {
          units.set(requirement.livePath, { kind: 'excluded', reason: 'non-regular-source' })
          continue
        }
        if (error instanceof UnportableSourceError) {
          units.set(requirement.livePath, { kind: 'excluded', reason: 'unportable-source' })
          continue
        }
        if (error instanceof CeilingExceededError) {
          units.set(requirement.livePath, { kind: 'excluded', reason: 'resource-ceiling-exceeded' })
          continue
        }
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          units.set(requirement.livePath, { kind: 'excluded', reason: 'changed-after-snapshot' })
          continue
        }
        throw error
      }
      total += scan.totalBytes
      units.set(requirement.livePath, { kind: 'directory', scan })
    }
    if (total > BigInt(BACKUP_CEILINGS.maxTotalUncompressedBytes)) {
      throw new CeilingExceededError('total-bytes', `${total} > ${BACKUP_CEILINGS.maxTotalUncompressedBytes}`)
    }
  }
  return { units, totalBytes: Number(total) }
}

export async function measureResourceStageBytes(
  input: Omit<StageResourcesInput, 'resourcesDir' | 'baseline'>
): Promise<number> {
  return (await captureResourceStageBaseline(input)).totalBytes
}

export async function stageResources(input: StageResourcesInput): Promise<StagedResources> {
  const { requirements, userDataPath, resourcesDir, signal } = input
  throwIfAborted(signal)
  assertRequirementSet(requirements)
  const baseline = input.baseline ?? (await captureResourceStageBaseline({ requirements, userDataPath, signal }))

  const payloads: ResourcePayload[] = []
  const degradations: BackupManifestDegradation[] = []

  for (const requirement of requirements) {
    throwIfAborted(signal)
    const sourcePath = absoluteOf(userDataPath, requirement.livePath)
    const captured = baseline.units.get(requirement.livePath)
    if (!captured) throw new Error(`resource baseline is missing requirement: ${requirement.livePath}`)
    if (captured.kind === 'excluded') {
      degradations.push({
        kind: `resource:${requirement.kind}`,
        livePath: requirement.livePath,
        reason: captured.reason
      })
      continue
    }
    const stagingPath = path.join(resourcesDir, ...requirement.livePath.split('/'))
    const common = {
      kind: requirement.kind,
      archivePath: `${RESOURCES_PREFIX}${requirement.livePath}`,
      livePath: requirement.livePath
    }
    try {
      if (requirement.resourceType === 'file') {
        if (captured.kind !== 'file') throw new Error(`resource baseline type mismatch: ${requirement.livePath}`)
        const staged = await stageFileUnit(sourcePath, stagingPath, captured.identity, signal)
        payloads.push({ ...common, resourceType: 'file', ...staged })
      } else {
        if (captured.kind !== 'directory') throw new Error(`resource baseline type mismatch: ${requirement.livePath}`)
        await mkdir(path.dirname(stagingPath), { recursive: true })
        const staged = await stageDirectoryWithDriftCheck({
          sourceDir: sourcePath,
          stagingDir: stagingPath,
          expectedScan: captured.scan,
          signal,
          excludeKnowledgeDerivedIndex: requirement.kind === KNOWLEDGE_KIND
        })
        // Hashing operation-owned output is an archive invariant. Keep it
        // outside the per-source catch: corruption here must fail the export,
        // never become a source degradation.
        const { hash } = await hashDirectoryUnit(stagingPath, { signal })
        payloads.push({
          ...common,
          resourceType: 'directory',
          hash,
          sizeBytes: staged.files.reduce((sum, file) => sum + file.size, 0)
        })
      }
    } catch (error) {
      const reason = classifyStagingDegradation(error, sourcePath)
      if (!reason) throw error
      await assertNoStagedUnit(stagingPath)
      await removeEmptyStagingAncestors(stagingPath, resourcesDir)
      degradations.push({ kind: `resource:${requirement.kind}`, livePath: requirement.livePath, reason })
    }
  }

  logger.info('Staged Full resource payloads', {
    payloads: payloads.length,
    degraded: degradations.length,
    bytes: payloads.reduce((sum, payload) => sum + payload.sizeBytes, 0)
  })
  return { payloads, degradations, staged: payloads.length > 0 }
}

function classifyStagingDegradation(error: unknown, sourcePath: string): ResourceDegradationReason | undefined {
  if (error instanceof SourceDriftError) return 'changed-after-snapshot'
  if (error instanceof UnportableSourceError) return 'unportable-source'
  if (error instanceof CeilingExceededError) return 'resource-ceiling-exceeded'
  if (error instanceof NonRegularSourceError) {
    return error.sourcePath === sourcePath ? 'changed-after-snapshot' : 'non-regular-source'
  }
  return undefined
}

async function assertNoStagedUnit(stagingPath: string): Promise<void> {
  try {
    await lstat(stagingPath)
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return
    throw error
  }
  throw new Error(`resource staging retained output after degradation: ${stagingPath}`)
}

/** Remove only empty operation-owned parents left by a unit that was discarded. */
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

async function stageFileUnit(
  sourcePath: string,
  stagingPath: string,
  expectedIdentity: FsIdentity,
  signal: AbortSignal | undefined
): Promise<{ hash: string; sizeBytes: number; executable: boolean }> {
  const staged = await stageFileWithDriftCheck({ sourcePath, stagingPath, expectedIdentity, signal })
  return { hash: staged.hash, sizeBytes: staged.size, executable: staged.executable }
}
