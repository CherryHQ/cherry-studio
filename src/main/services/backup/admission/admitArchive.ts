import { lstat, readFile, realpath, rm, stat } from 'node:fs/promises'

import type { AppliedMigration } from '@data/db/restore/appliedChain'

import { BACKUP_CEILINGS } from '../ceilings'
import type { DirScanLimits } from '../dirScan'
import { assertDiskHeadroom } from '../diskPreflight'
import { ArchiveAdmissionError, BackupCancelledError, BackupFormatCompatibilityError } from '../errors'
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  parseBackupManifest,
  parseManifestDiagnosticEnvelope
} from '../manifest'
import { type CatalogCeilings, openArchive, validateArchiveShape } from './catalog'
import { admitStagedDatabase } from './chain'
import {
  createStagingDir,
  ExtractionBudget,
  extractManifest,
  extractPayload,
  stagedDbName,
  stagedManifestName,
  stagedPathOf
} from './extract'
import { classifyPayloadLayout } from './layout'
import { type AdmittedResource, verifyDbPayload, verifyResourcePayloads, verifyStagedTree } from './verify'

/**
 * Hostile-archive admission — the single trust boundary for Backup v2
 * (docs/references/backup/README.md §5.2). Given an untrusted `.cherrybackup`
 * ZIP and an already-resolved existing staging parent, it:
 *
 * 1. catalogs every central-directory entry (duplicate-preserving) and rejects
 *    the archive on its metadata alone — path escapes, symlink/special entries,
 *    collisions, and every ceiling — BEFORE a single byte is written;
 * 2. disk-preflights the resolved staging volume, then extracts entry-by-entry
 *    through bounded streams (real actual-byte budget) ONLY into a freshly
 *    created, operation-owned staging directory under that parent;
 * 3. re-proves the whole staged tree against the filesystem (no symlink/special,
 *    no realpath escape) and recomputes every DB/resource size + hash;
 * 4. proves migration-chain compatibility, migrates a strict-prefix DB forward
 *    with the production migrations, and seals the DB (no WAL/SHM sidecars).
 *
 * It creates NO restore journal and touches NO live DB or resources — this
 * module has no such dependency, so every failure necessarily precedes any
 * mutating stage. On success the caller OWNS the returned staging tree (and can
 * later seal/journal it); on any failure or cancellation nothing remains.
 *
 * OWNERSHIP: the owned staging root's bigint identity is snapshotted at creation;
 * both failure cleanup and the returned idempotent `cleanup()` refuse to remove a
 * root whose identity has changed (a replacement directory/symlink). There
 * remains a narrow residual TOCTOU window between the identity `lstat` and the
 * `rm` — Node's `fs.promises` exposes no `openat`/dir-fd removal to close it — but
 * the staging parent is a caller-resolved, app-owned location, so this is not an
 * attacker-controlled path.
 */

/** Admission ceilings — the same shape the catalog reads; defaults to the frozen contract. */
export type AdmissionCeilings = CatalogCeilings

const DEFAULT_ADMISSION_CEILINGS: AdmissionCeilings = Object.freeze({
  maxArchiveEntries: BACKUP_CEILINGS.maxArchiveEntries,
  maxEntryUncompressedBytes: BACKUP_CEILINGS.maxEntryUncompressedBytes,
  maxTotalUncompressedBytes: BACKUP_CEILINGS.maxTotalUncompressedBytes,
  maxCompressionRatio: BACKUP_CEILINGS.maxCompressionRatio,
  maxManifestBytes: BACKUP_CEILINGS.maxManifestBytes,
  maxPathDepth: BACKUP_CEILINGS.maxPathDepth,
  maxPathLength: BACKUP_CEILINGS.maxPathLength
})

export interface AdmitArchiveInputs {
  /** Untrusted `.cherrybackup` ZIP to admit. */
  readonly archivePath: string
  /** An existing directory under which the owned staging tree is created (resolved to an absolute realpath first). */
  readonly stagingParent: string
  /** Production migrations folder (the later service passes `application.getPath('app.database.migrations')`). */
  readonly migrationsFolder: string
  readonly signal?: AbortSignal
  /** Narrowed ceilings for tests; defaults to the frozen {@link BACKUP_CEILINGS}. */
  readonly ceilings?: AdmissionCeilings
}

/** Sealed admission result. Every path is absolute and under the owned {@link stagingDir}. */
export interface AdmittedArchive {
  /** The operation-owned staging root (absolute); the caller becomes its owner. */
  readonly stagingDir: string
  /** The parsed ORIGINAL manifest — never mutated by migrate-forward. */
  readonly manifest: BackupManifest
  /** Sealed FINAL DB metadata (recomputed after any migrate-forward + WAL seal). */
  readonly db: { readonly path: string; readonly sizeBytes: number; readonly hash: string }
  /** True when the staged DB was a strict prefix migrated forward to the bundled chain. */
  readonly migratedForward: boolean
  /** The sealed final applied chain (equals the bundled production chain). */
  readonly finalChain: readonly AppliedMigration[]
  /** Verified resource units (Full); empty for Lite. */
  readonly resources: readonly AdmittedResource[]
  /** Idempotent removal of the owned staging tree; refuses a replacement root. */
  readonly cleanup: () => Promise<void>
}

interface OwnedIdentity {
  readonly dev: bigint
  readonly ino: bigint
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError()
}

function dirScanLimitsOf(ceilings: AdmissionCeilings): DirScanLimits {
  return {
    maxEntries: ceilings.maxArchiveEntries,
    maxEntryBytes: ceilings.maxEntryUncompressedBytes,
    maxTotalBytes: ceilings.maxTotalUncompressedBytes,
    maxPathDepth: ceilings.maxPathDepth,
    maxPathLength: ceilings.maxPathLength
  }
}

/** Resolve the caller-provided staging parent to an absolute realpath and prove it is a directory. */
async function resolveStagingParent(stagingParent: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(stagingParent)
  } catch {
    throw new Error('admitArchive: stagingParent could not be resolved (does it exist?)')
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error('admitArchive: stagingParent is not a directory')
  }
  return resolved
}

/**
 * Remove the owned staging tree — but ONLY if its on-disk type AND identity
 * still match the one snapshotted at creation. Idempotent: an already-absent
 * root is a no-op. A replacement root (different dev/ino, or a symlink or other
 * non-directory swapped in — including one that recycled the freed inode) is left
 * untouched AND reported: the returned `cleanup()` must NOT silently resolve as
 * if it removed the sensitive staging DB (a caller could then wrongly clear
 * dependent state). Internal failure cleanup suppresses the throw to preserve the
 * original rejection.
 */
async function safeRemoveOwned(stagingDir: string, identity: OwnedIdentity): Promise<void> {
  let st: Awaited<ReturnType<typeof lstat>>
  try {
    st = await lstat(stagingDir, { bigint: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  // Type FIRST, then identity. `(dev, ino)` alone is not proof of sameness: a
  // freed directory inode can be recycled for whatever is created in its place,
  // so a symlink swapped in immediately after an `rm` can inherit the exact
  // numbers snapshotted at creation (observed on CI's Linux filesystem, never on
  // APFS). The owned root was created as a real directory and nothing legitimate
  // changes its type.
  if (st.isSymbolicLink() || !st.isDirectory() || st.dev !== identity.dev || st.ino !== identity.ino) {
    throw new ArchiveAdmissionError('staging-escape', 'owned staging root was replaced; refusing to remove it')
  }
  await rm(stagingDir, { recursive: true, force: true })
}

async function readAndParseManifest(stagingDir: string): Promise<BackupManifest> {
  const bytes = await readFile(stagedPathOf(stagingDir, stagedManifestName))
  let json: unknown
  try {
    json = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ArchiveAdmissionError('manifest-invalid', 'manifest.json is not valid JSON')
  }
  const envelope = parseManifestDiagnosticEnvelope(json)
  if (envelope && envelope.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupFormatCompatibilityError({
      archiveFormatVersion: envelope.backupFormatVersion,
      archiveAppVersion: envelope.producer?.appVersion,
      archiveBuildType: envelope.producer?.buildType ?? 'unknown'
    })
  }

  const parsed = parseBackupManifest(json)
  if (parsed.kind !== 'ok') {
    // Constant detail: the Zod error can echo attacker-controlled manifest values.
    throw new ArchiveAdmissionError('manifest-invalid', 'manifest.json failed strict schema validation')
  }
  return parsed.manifest
}

export async function admitArchive(inputs: AdmitArchiveInputs): Promise<AdmittedArchive> {
  const { archivePath, migrationsFolder, signal } = inputs
  const ceilings = inputs.ceilings ?? DEFAULT_ADMISSION_CEILINGS

  throwIfAborted(signal)
  const stagingParent = await resolveStagingParent(inputs.stagingParent)
  const open = await openArchive(archivePath)

  let stagingDir: string | undefined
  let ownedId: OwnedIdentity | undefined
  try {
    // Pre-extraction: reject on metadata alone, before any staging exists.
    const shape = validateArchiveShape(open.entries, ceilings)
    throwIfAborted(signal)

    // Disk headroom on the resolved staging volume, before mkdtemp/writes.
    await assertDiskHeadroom({ target: stagingParent, neededBytes: shape.declaredTotalBytes })

    stagingDir = await createStagingDir(stagingParent)
    const owned = await stat(stagingDir, { bigint: true })
    ownedId = { dev: owned.dev, ino: owned.ino }

    const budget = new ExtractionBudget(ceilings.maxTotalUncompressedBytes)

    // Manifest first (bounded, shared budget), so payload layout can be classified
    // before the resource bytes are extracted.
    await extractManifest(open.zip, shape, stagingDir, ceilings.maxManifestBytes, budget, signal)
    const manifest = await readAndParseManifest(stagingDir)
    const units = classifyPayloadLayout(shape, manifest)

    await extractPayload(open.zip, shape, stagingDir, ceilings.maxEntryUncompressedBytes, budget, signal)

    // Post-extraction: prove the tree, then every declared fact, over real bytes.
    const stagedResourceFiles = await verifyStagedTree(stagingDir, signal)
    await verifyDbPayload(stagingDir, manifest, signal)
    const resources = await verifyResourcePayloads(
      stagingDir,
      units,
      stagedResourceFiles,
      shape.resourceFiles,
      dirScanLimitsOf(ceilings),
      signal
    )

    const dbPath = stagedPathOf(stagingDir, stagedDbName)
    const dbAdmission = await admitStagedDatabase(dbPath, manifest, migrationsFolder, signal)

    const sealedDir = stagingDir
    const sealedId = ownedId
    return {
      stagingDir: sealedDir,
      manifest,
      db: { path: dbPath, sizeBytes: dbAdmission.sizeBytes, hash: dbAdmission.hash },
      migratedForward: dbAdmission.migratedForward,
      finalChain: dbAdmission.finalChain,
      resources,
      cleanup: () => safeRemoveOwned(sealedDir, sealedId)
    }
  } catch (err) {
    // Owned-only, identity-guarded cleanup: remove our staging tree (never a
    // sibling or a replacement root). Best-effort so the rejection propagates.
    if (stagingDir && ownedId) await safeRemoveOwned(stagingDir, ownedId).catch(() => {})
    throw err
  } finally {
    await open.close()
  }
}
