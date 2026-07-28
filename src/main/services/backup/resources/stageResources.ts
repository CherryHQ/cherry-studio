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
 * - **Changing WHILE being staged** fails the export closed, because the archive
 *   could no longer prove which version it holds. That judgement lives in
 *   `sourceDrift.ts`; this module only propagates it.
 *
 * A payload's `archivePath` is its `livePath` under `resources/`, so the archive
 * mirrors the layout it will be installed into and payload distinctness follows
 * from destination distinctness — which is checked here, with the same collision
 * rules admission will re-apply.
 */

import fs from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

import { RESOURCES_PREFIX } from '../archiveLayout'
import { BACKUP_CEILINGS } from '../ceilings'
import { type DirScanResult, type FsIdentity, fsIdentityOf, scanDirectoryUnit } from '../dirScan'
import { BackupCancelledError, CeilingExceededError } from '../errors'
import { hashDirectoryUnit } from '../hashing'
import type { BackupManifestDegradation, ResourcePayload, ResourceRequirement } from '../manifest'
import { validateResourcePathSet } from '../resourcePaths'
import { stageDirectoryWithDriftCheck, stageFileWithDriftCheck } from '../sourceDrift'

const logger = loggerService.withContext('backupStageResources')

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
  | { readonly kind: 'missing'; readonly reason: string }

export type ResourceUnitBaseline =
  | { readonly kind: 'missing'; readonly reason: string }
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing', reason: 'absent at snapshot time' }
    }
    throw error
  }
  if (requirement.resourceType === 'file' ? stats.isFile() : stats.isDirectory()) {
    return { kind: 'present', stats }
  }
  return { kind: 'missing', reason: `not a ${requirement.resourceType} at snapshot time` }
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
    if (inspected.kind === 'missing') {
      units.set(requirement.livePath, inspected)
      continue
    }

    if (requirement.resourceType === 'file') {
      const sizeBytes = inspected.stats.size
      total += sizeBytes
      units.set(requirement.livePath, {
        kind: 'file',
        identity: fsIdentityOf(inspected.stats, 'file'),
        sizeBytes
      })
    } else {
      const scan = await scanDirectoryUnit(sourcePath, {
        signal,
        excludeKnowledgeDerivedIndex: requirement.kind === KNOWLEDGE_KIND
      })
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
    if (captured.kind === 'missing') {
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
    if (requirement.resourceType === 'file') {
      if (captured.kind !== 'file') throw new Error(`resource baseline type mismatch: ${requirement.livePath}`)
      const staged = await stageFileUnit(sourcePath, stagingPath, captured.identity, signal)
      payloads.push({ ...common, resourceType: 'file', ...staged })
    } else {
      if (captured.kind !== 'directory') throw new Error(`resource baseline type mismatch: ${requirement.livePath}`)
      const staged = await stageDirectoryUnit(
        sourcePath,
        stagingPath,
        requirement.kind === KNOWLEDGE_KIND,
        captured.scan,
        signal
      )
      payloads.push({ ...common, resourceType: 'directory', ...staged })
    }
  }

  logger.info('Staged Full resource payloads', {
    payloads: payloads.length,
    degraded: degradations.length,
    bytes: payloads.reduce((sum, payload) => sum + payload.sizeBytes, 0)
  })
  return { payloads, degradations, staged: payloads.length > 0 }
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

/**
 * A directory unit is content-addressed by the canonical unit hash over the
 * STAGED tree (§5.1.2) — the same digest admission recomputes over the extracted
 * tree, from the same scanner. Hashing the staged copy rather than the source
 * also means the hash describes exactly what the archive carries, including the
 * Knowledge index exclusion that staging already applied.
 */
async function stageDirectoryUnit(
  sourceDir: string,
  stagingDir: string,
  excludeKnowledgeDerivedIndex: boolean,
  expectedScan: DirScanResult,
  signal: AbortSignal | undefined
): Promise<{ hash: string; sizeBytes: number }> {
  // The stager creates the unit root EXCLUSIVELY (ownership proof), so its
  // parent — and only its parent — is created here.
  await mkdir(path.dirname(stagingDir), { recursive: true })
  const staged = await stageDirectoryWithDriftCheck({
    sourceDir,
    stagingDir,
    expectedScan,
    signal,
    excludeKnowledgeDerivedIndex
  })
  const { hash } = await hashDirectoryUnit(stagingDir, { signal })
  return { hash, sizeBytes: staged.files.reduce((sum, file) => sum + file.size, 0) }
}
