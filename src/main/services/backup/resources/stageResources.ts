/**
 * Resource staging (docs/references/backup/README.md §1.7, §5.4).
 *
 * Turns the requirement inventory — what the exported database SAYS it needs —
 * into the payload inventory the archive actually carries. Each unit is copied
 * into the operation-owned staging tree through the shared drift-checked stagers,
 * so the archive can name the exact bytes it captured.
 *
 * The two failure modes are deliberately different (§1.7):
 *
 * - **Already absent, the opposite ordinary kind, or an uncapturable resource
 *   root at seal time** is an explicit whole-unit degradation.
 * - **Present but not rebuildable** is also omitted as a whole unit: derived
 *   state is excluded only when its database-declared source material exists.
 * - **Untransportable entries inside a directory** are omitted individually and
 *   disclosed while the rest of the payload is preserved.
 * - **Unportable/over-ceiling sources, or any change after the sealed baseline**
 *   fail the whole export. Continuing would publish a database and filesystem
 *   view that the transaction can no longer prove belong together.
 *
 * A payload's `archivePath` is its `livePath` under `resources/`, so the archive
 * mirrors the layout it will be installed into and payload distinctness follows
 * from destination distinctness — which is checked here, with the same collision
 * rules admission will re-apply.
 */

import fs from 'node:fs'
import { mkdir, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { isSafeRelativeSubpath } from '@main/utils/relativePath'

import { RESOURCES_PREFIX } from '../archiveLayout'
import { BACKUP_CEILINGS, FIXED_ARCHIVE_ENTRIES } from '../ceilings'
import { type DirScanResult, type FsIdentity, fsIdentityOf, identitiesEqual, scanDirectoryUnit } from '../dirScan'
import { BackupCancelledError, CeilingExceededError, SourceDriftError } from '../errors'
import { hashDirectoryUnit } from '../hashing'
import {
  type BackupManifestDegradation,
  type ResourceDegradationReason,
  type ResourcePayload,
  type ResourceRequirement
} from '../manifest'
import { validateResourcePathSet } from '../resourcePaths'
import { scansEqual, stageDirectoryWithDriftCheck, stageFileWithDriftCheck } from '../sourceDrift'
import { capturePolicyForKind, type ResourceRoots, type UnitContentRequirement } from './adapters'

const logger = loggerService.withContext('backupStageResources')

/** Deterministic seam for source changes between root inspection and directory scanning. */
export const stageResourceHooks = {
  async afterBaselineInspect(sourcePath: string): Promise<void> {
    void sourcePath
  },
  async afterBaselineScan(sourcePath: string): Promise<void> {
    void sourcePath
  }
}

export interface StageResourcesInput {
  /** The inventory the exported database produced; every entry is a candidate payload. */
  readonly requirements: readonly ResourceRequirement[]
  /** Producer userData root that each `livePath` is relative to. */
  readonly userDataPath: string
  /** Operation-owned directory the payloads are staged under (`resources/` in the archive). */
  readonly resourcesDir: string
  /** Unit identities captured right after the database snapshot; staging is checked against them. */
  readonly baseline?: ResourceStageBaseline
  /**
   * Per-unit source material the database says the payload must carry, from
   * `collectRequirements`. A unit that cannot supply it is excluded whole rather
   * than shipped as content no device could rebuild — see the module header.
   */
  readonly requiredContent?: ReadonlyMap<string, UnitContentRequirement>
  /** Producer managed roots used only by owner capture classification. */
  readonly roots?: ResourceRoots
  readonly signal?: AbortSignal
}

export interface StagedResources {
  readonly payloads: readonly ResourcePayload[]
  /** Whole-unit and per-entry omissions disclosed in the manifest (§1.7). */
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
  | {
      readonly kind: 'excluded'
      readonly reason: ResourceDegradationReason
      readonly proof?: { readonly identity: FsIdentity; readonly linkTarget?: string }
    }

export type ResourceUnitBaseline =
  | {
      readonly kind: 'excluded'
      readonly reason: ResourceDegradationReason
      readonly proof?: { readonly identity: FsIdentity; readonly linkTarget?: string }
      /** Present for a captured directory omitted only because it cannot be rebuilt. */
      readonly scan?: DirScanResult
    }
  | { readonly kind: 'file'; readonly identity: FsIdentity; readonly sizeBytes: bigint }
  | { readonly kind: 'directory'; readonly scan: DirScanResult }

export interface ResourceStageBaseline {
  readonly units: ReadonlyMap<string, ResourceUnitBaseline>
  readonly totalBytes: number
  /**
   * Archive entries the payloads this baseline admits will occupy, including the
   * two fixed ones. Excluded units contribute nothing — they never become
   * payloads.
   */
  readonly entryCount: number
}

function inspectSource(sourcePath: string, requirement: ResourceRequirement): SourceInspection {
  let stats: fs.BigIntStats
  try {
    stats = fs.lstatSync(sourcePath, { bigint: true })
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return { kind: 'excluded', reason: 'absent-at-snapshot' }
    }
    if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return { kind: 'excluded', reason: 'unclassified-reference' }
    }
    throw error
  }
  if (requirement.resourceType === 'file' ? stats.isFile() : stats.isDirectory()) {
    return { kind: 'present', stats }
  }
  if (stats.isSymbolicLink()) {
    let linkTarget: string | undefined
    try {
      linkTarget = fs.readlinkSync(sourcePath)
    } catch {
      // The identity still proves replacement/deletion after the seal.
    }
    return {
      kind: 'excluded',
      reason: 'external-reference',
      proof: {
        identity: fsIdentityOf(stats, 'symlink'),
        ...(linkTarget !== undefined ? { linkTarget } : {})
      }
    }
  }
  if (!stats.isFile() && !stats.isDirectory()) {
    return {
      kind: 'excluded',
      reason: 'unclassified-reference',
      proof: { identity: fsIdentityOf(stats, 'special') }
    }
  }
  return {
    kind: 'excluded',
    reason: 'type-mismatch-at-snapshot',
    proof: { identity: fsIdentityOf(stats, stats.isFile() ? 'file' : 'dir') }
  }
}

function canReadSealedFile(sourcePath: string, expected: fs.BigIntStats): boolean {
  let fd: number
  try {
    fd = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
  try {
    const opened = fs.fstatSync(fd, { bigint: true })
    if (!opened.isFile() || !identitiesEqual(fsIdentityOf(expected, 'file'), fsIdentityOf(opened, 'file'))) {
      throw new SourceDriftError(sourcePath, 'file changed while baseline readability was checked')
    }
    return true
  } finally {
    fs.closeSync(fd)
  }
}

async function assertExcludedSourceStillMatches(
  sourcePath: string,
  requirement: ResourceRequirement,
  expected: Extract<ResourceUnitBaseline, { kind: 'excluded' }>,
  roots: ResourceRoots | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  if (expected.scan) {
    const current = await scanDirectoryUnit(sourcePath, {
      signal,
      mode: 'capture',
      capturePolicy: capturePolicyForKind(requirement.kind, roots)
    })
    if (!scansEqual(expected.scan, current)) {
      throw new SourceDriftError(sourcePath, `source no longer matches sealed degradation ${expected.reason}`)
    }
    return
  }

  if (expected.proof) {
    let stats: fs.BigIntStats
    try {
      stats = fs.lstatSync(sourcePath, { bigint: true })
    } catch {
      throw new SourceDriftError(sourcePath, `source no longer matches sealed degradation ${expected.reason}`)
    }
    const kind: FsIdentity['kind'] = stats.isSymbolicLink()
      ? 'symlink'
      : stats.isFile()
        ? 'file'
        : stats.isDirectory()
          ? 'dir'
          : 'special'
    if (!identitiesEqual(expected.proof.identity, fsIdentityOf(stats, kind))) {
      throw new SourceDriftError(sourcePath, `source no longer matches sealed degradation ${expected.reason}`)
    }
    if (expected.reason === 'unclassified-reference' && kind === 'file' && canReadSealedFile(sourcePath, stats)) {
      throw new SourceDriftError(sourcePath, 'previously unreadable file became capturable after sealing')
    }
    if (expected.reason === 'unclassified-reference' && kind === 'dir') {
      try {
        fs.readdirSync(sourcePath)
        throw new SourceDriftError(sourcePath, 'previously unreadable directory became capturable after sealing')
      } catch (error) {
        if (error instanceof SourceDriftError) throw error
        if (!['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
    if (expected.proof.linkTarget !== undefined) {
      let currentTarget: string
      try {
        currentTarget = fs.readlinkSync(sourcePath)
      } catch {
        throw new SourceDriftError(sourcePath, 'excluded root link is no longer readable')
      }
      if (currentTarget !== expected.proof.linkTarget) {
        throw new SourceDriftError(sourcePath, 'excluded root link target changed after sealing')
      }
    }
    return
  }

  const current = inspectSource(sourcePath, requirement)
  if (current.kind !== 'excluded' || current.reason !== expected.reason) {
    throw new SourceDriftError(sourcePath, `source no longer matches sealed degradation ${expected.reason}`)
  }
}

/**
 * Whether a scanned unit carries every file its database rows say it must, so a
 * restoring device can rebuild the derived state the archive excludes (§5.4).
 * A unit with nothing to declare passes; one whose declaration is unsatisfiable
 * (`null`) never can.
 */
function carriesRequiredContent(scan: DirScanResult, required: UnitContentRequirement | undefined): boolean {
  if (required === undefined) return true
  if (required === null) return false
  const present = new Set(scan.entries.map((entry) => entry.relPath))
  return required.every((relPath) => present.has(relPath))
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
 * Excluded roots and omitted directory entries contribute no bytes. Directory
 * scans are immediately repeated to prove the baseline did not move while it
 * was being enumerated, and the archive-wide entry ceiling is enforced before
 * staging starts.
 */
export async function captureResourceStageBaseline(
  input: Omit<StageResourcesInput, 'resourcesDir' | 'baseline'>
): Promise<ResourceStageBaseline> {
  const { requirements, userDataPath, requiredContent, roots, signal } = input
  throwIfAborted(signal)
  assertRequirementSet(requirements)

  const units = new Map<string, ResourceUnitBaseline>()
  let total = 0n
  let entries = FIXED_ARCHIVE_ENTRIES
  const countEntries = (count: number): void => {
    entries += count
    if (entries > BACKUP_CEILINGS.maxArchiveEntries) {
      // Publication enforces the same bound, but only after every payload has
      // been copied. Refusing here means an over-sized profile costs a scan
      // rather than a full staging tree.
      throw new CeilingExceededError('entry-count', `${entries} > ${BACKUP_CEILINGS.maxArchiveEntries}`)
    }
  }
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
      if (!canReadSealedFile(sourcePath, inspected.stats)) {
        units.set(requirement.livePath, {
          kind: 'excluded',
          reason: 'unclassified-reference',
          proof: { identity: fsIdentityOf(inspected.stats, 'file') }
        })
        continue
      }
      const sizeBytes = inspected.stats.size
      if (sizeBytes > BigInt(BACKUP_CEILINGS.maxEntryUncompressedBytes)) {
        throw new CeilingExceededError(
          'entry-bytes',
          `${requirement.livePath} is ${sizeBytes} > ${BACKUP_CEILINGS.maxEntryUncompressedBytes}`
        )
      }
      total += sizeBytes
      countEntries(1)
      units.set(requirement.livePath, {
        kind: 'file',
        identity: fsIdentityOf(inspected.stats, 'file'),
        sizeBytes
      })
    } else {
      const capturePolicy = capturePolicyForKind(requirement.kind, roots)
      let scan: DirScanResult
      try {
        scan = await scanDirectoryUnit(sourcePath, {
          signal,
          mode: 'capture',
          capturePolicy
        })
      } catch (error) {
        if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          units.set(requirement.livePath, {
            kind: 'excluded',
            reason: 'unclassified-reference',
            proof: { identity: fsIdentityOf(inspected.stats, 'dir') }
          })
          continue
        }
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw new SourceDriftError(sourcePath, 'directory disappeared during baseline capture')
        }
        throw error
      }
      await stageResourceHooks.afterBaselineScan(sourcePath)
      let verification: DirScanResult
      try {
        verification = await scanDirectoryUnit(sourcePath, { signal, mode: 'capture', capturePolicy })
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw new SourceDriftError(sourcePath, 'directory disappeared during baseline verification')
        }
        throw error
      }
      if (!scansEqual(scan, verification)) {
        throw new SourceDriftError(sourcePath, 'directory changed during baseline capture')
      }
      if (!carriesRequiredContent(scan, requiredContent?.get(requirement.livePath))) {
        units.set(requirement.livePath, {
          kind: 'excluded',
          reason: 'unrebuildable-content',
          scan
        })
        continue
      }
      total += scan.totalBytes
      countEntries(scan.entryCount)
      units.set(requirement.livePath, { kind: 'directory', scan })
    }
    if (total > BigInt(BACKUP_CEILINGS.maxTotalUncompressedBytes)) {
      throw new CeilingExceededError('total-bytes', `${total} > ${BACKUP_CEILINGS.maxTotalUncompressedBytes}`)
    }
  }
  return { units, totalBytes: Number(total), entryCount: entries }
}

export async function measureResourceStageBytes(
  input: Omit<StageResourcesInput, 'resourcesDir' | 'baseline'>
): Promise<number> {
  return (await captureResourceStageBaseline(input)).totalBytes
}

export async function stageResources(input: StageResourcesInput): Promise<StagedResources> {
  const { requirements, userDataPath, resourcesDir, requiredContent, roots, signal } = input
  throwIfAborted(signal)
  assertRequirementSet(requirements)
  const baseline =
    input.baseline ??
    (await captureResourceStageBaseline({ requirements, userDataPath, requiredContent, roots, signal }))

  const payloads: ResourcePayload[] = []
  const degradations: BackupManifestDegradation[] = []

  for (const requirement of requirements) {
    throwIfAborted(signal)
    const sourcePath = absoluteOf(userDataPath, requirement.livePath)
    const captured = baseline.units.get(requirement.livePath)
    if (!captured) throw new Error(`resource baseline is missing requirement: ${requirement.livePath}`)
    if (captured.kind === 'excluded') {
      // A degradation describes the sealed view, not a permission to ignore
      // later source creation/type repair. Recheck the classification after
      // writers resume so a newly materialized resource cannot be paired with
      // the older detached database.
      await assertExcludedSourceStillMatches(sourcePath, requirement, captured, roots, signal)
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
        await mkdir(path.dirname(stagingPath), { recursive: true, mode: 0o700 })
        const capturePolicy = capturePolicyForKind(requirement.kind, roots)
        const staged = await stageDirectoryWithDriftCheck({
          sourceDir: sourcePath,
          stagingDir: stagingPath,
          expectedScan: captured.scan,
          signal,
          capturePolicy
        })
        for (const omission of captured.scan.omissions) {
          const nestedLivePath = `${requirement.livePath}/${omission.relPath}`
          degradations.push({
            kind: `resource-entry:${requirement.kind}`,
            reason: omission.reason,
            ...(isSafeRelativeSubpath(nestedLivePath) ? { livePath: nestedLivePath } : {})
          })
        }
        // Hashing operation-owned output is an archive invariant. Corruption
        // here fails the export and can never become a source degradation.
        const { hash } = await hashDirectoryUnit(stagingPath, { signal })
        payloads.push({
          ...common,
          resourceType: 'directory',
          hash,
          sizeBytes: staged.files.reduce((sum, file) => sum + file.size, 0)
        })
      }
    } catch (error) {
      // This unit is transaction-private and requirements cannot overlap.
      // Best-effort local cleanup keeps large failures bounded; the operation
      // owner still removes the complete staging tree during rollback.
      await rm(stagingPath, { recursive: true, force: true }).catch((cleanupError) => {
        logger.warn('Could not remove failed resource staging unit', cleanupError as Error, {
          livePath: requirement.livePath
        })
      })
      await removeEmptyStagingAncestors(stagingPath, resourcesDir).catch((cleanupError) => {
        logger.warn('Could not prune failed resource staging parents', cleanupError as Error, {
          livePath: requirement.livePath
        })
      })
      throw error
    }
  }

  logger.info('Staged Full resource payloads', {
    payloads: payloads.length,
    degraded: degradations.length,
    bytes: payloads.reduce((sum, payload) => sum + payload.sizeBytes, 0)
  })
  return { payloads, degradations, staged: payloads.length > 0 }
}

/** Remove only empty operation-owned parents left by a failed unit. */
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
