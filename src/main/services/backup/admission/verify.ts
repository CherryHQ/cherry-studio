import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { RESOURCES_PREFIX } from '../archiveLayout'
import type { DirScanLimits } from '../dirScan'
import { ArchiveAdmissionError, BackupCancelledError, renderUntrustedName } from '../errors'
import { hashDirectoryUnit, sha256FileCancellable } from '../hashing'
import type { BackupManifest } from '../manifest'
import { stagedDbName, stagedPathOf } from './extract'
import { buildCoverageIndex, type CoverageUnit } from './layout'

/**
 * Post-extraction verification for archive admission (Phase 1b-ii,
 * docs/references/backup/README.md §5.2). Everything here runs over the OWNED
 * staged tree only, and proves — against the filesystem, not the ZIP metadata —
 * that:
 * - no staged node is a symlink/special file and no realpath escapes the staging
 *   root (a defence in depth over extraction, which never creates symlinks);
 * - the staged DB's recomputed size + SHA-256 equal the manifest;
 * - every declared resource payload's recomputed size + hash equal the manifest
 *   (file unit = raw SHA-256/size; directory unit = the canonical
 *   {@link hashDirectoryUnit} framing and the sum of regular-file bytes, via the
 *   SAME shared scanner the producer used, so the two can never disagree);
 * - every staged regular file under `resources/` is covered by exactly one
 *   declared unit — so the inventory agrees in BOTH directions.
 */

/** One verified resource unit sealed under the owned staging tree. */
export interface AdmittedResource {
  readonly kind: string
  readonly resourceType: 'file' | 'directory'
  /** Absolute staged path under the owned admission staging tree. */
  readonly stagedPath: string
  /** userData-relative install destination, from the manifest payload. */
  readonly livePath: string
  readonly sizeBytes: number
  readonly hash: string
}

function isContained(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep)
}

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

/**
 * Recursively `lstat` + `realpath` every staged node, rejecting symlink/special
 * nodes and any realpath that escapes the resolved staging root. Returns the
 * POSIX-relative paths of every regular file under `resources/`.
 */
export async function verifyStagedTree(stagingDir: string, signal: AbortSignal | undefined): Promise<string[]> {
  const realRoot = await realpath(stagingDir)
  const resourceFiles: string[] = []

  const walk = async (absDir: string): Promise<void> => {
    if (signal?.aborted) throw new BackupCancelledError()
    const names = await readdir(absDir)
    for (const name of names) {
      if (signal?.aborted) throw new BackupCancelledError()
      const abs = path.join(absDir, name)
      const st = await lstat(abs)
      if (st.isSymbolicLink()) {
        throw new ArchiveAdmissionError(
          'staging-escape',
          `staged symlink: ${renderUntrustedName(toPosixRel(realRoot, abs))}`
        )
      }
      const resolved = await realpath(abs)
      if (!isContained(resolved, realRoot)) {
        throw new ArchiveAdmissionError(
          'staging-escape',
          `staged node escapes staging root: ${renderUntrustedName(toPosixRel(realRoot, abs))}`
        )
      }
      if (st.isDirectory()) {
        await walk(abs)
      } else if (st.isFile()) {
        const rel = toPosixRel(realRoot, abs)
        if (rel.startsWith(RESOURCES_PREFIX)) resourceFiles.push(rel)
      } else {
        throw new ArchiveAdmissionError(
          'staging-escape',
          `staged special file: ${renderUntrustedName(toPosixRel(realRoot, abs))}`
        )
      }
    }
  }

  await walk(realRoot)
  return resourceFiles
}

/** Recompute the staged DB size + SHA-256 (cancellable) and require agreement with the manifest. */
export async function verifyDbPayload(
  stagingDir: string,
  manifest: BackupManifest,
  signal: AbortSignal | undefined
): Promise<void> {
  if (signal?.aborted) throw new BackupCancelledError()
  const dbPath = stagedPathOf(stagingDir, stagedDbName)
  const st = await stat(dbPath)
  if (st.size !== manifest.db.sizeBytes) {
    throw new ArchiveAdmissionError('payload-mismatch', `db size ${st.size} != manifest ${manifest.db.sizeBytes}`)
  }
  const hash = await sha256FileCancellable(dbPath, signal)
  if (hash !== manifest.db.hash) {
    throw new ArchiveAdmissionError('payload-mismatch', 'db sha256 != manifest')
  }
}

async function verifyDirectoryUnit(
  stagedPath: string,
  unit: CoverageUnit,
  dirScanLimits: DirScanLimits,
  signal: AbortSignal | undefined
): Promise<{ hash: string; sizeBytes: number }> {
  let result: Awaited<ReturnType<typeof hashDirectoryUnit>>
  try {
    result = await hashDirectoryUnit(stagedPath, { signal, limits: dirScanLimits })
  } catch (err) {
    if (err instanceof BackupCancelledError) throw err
    // A NonRegular / Unportable / Ceiling failure over an already-extracted,
    // already-validated tree means the archive does not carry what it declared.
    throw new ArchiveAdmissionError(
      'payload-mismatch',
      `directory unit ${renderUntrustedName(unit.payload.archivePath)} not verifiable`
    )
  }
  const sizeBytes = result.files.reduce((sum, file) => sum + file.size, 0)
  return { hash: result.hash, sizeBytes }
}

async function verifyFileUnit(
  stagedPath: string,
  unit: CoverageUnit,
  signal: AbortSignal | undefined
): Promise<{ hash: string; sizeBytes: number }> {
  const st = await lstat(stagedPath)
  const label = renderUntrustedName(unit.payload.archivePath)
  if (!st.isFile()) {
    throw new ArchiveAdmissionError('payload-mismatch', `file unit ${label} is not a regular file`)
  }
  if (st.size !== unit.payload.sizeBytes) {
    throw new ArchiveAdmissionError('payload-mismatch', `file unit ${label} size mismatch`)
  }
  const hash = await sha256FileCancellable(stagedPath, signal)
  return { hash, sizeBytes: st.size }
}

/**
 * Recompute every declared payload's size + hash from the staged tree and prove
 * exact inventory agreement (every staged resource file covered by exactly one
 * unit). Returns the sealed resource units.
 */
export async function verifyResourcePayloads(
  stagingDir: string,
  units: readonly CoverageUnit[],
  stagedResourceFiles: readonly string[],
  dirScanLimits: DirScanLimits,
  signal: AbortSignal | undefined
): Promise<AdmittedResource[]> {
  const coverage = buildCoverageIndex(units)
  const resources: AdmittedResource[] = []
  for (const unit of units) {
    if (signal?.aborted) throw new BackupCancelledError()
    const stagedPath = stagedPathOf(stagingDir, unit.payload.archivePath)
    const computed = unit.isDirectory
      ? await verifyDirectoryUnit(stagedPath, unit, dirScanLimits, signal)
      : await verifyFileUnit(stagedPath, unit, signal)
    if (computed.hash !== unit.payload.hash) {
      throw new ArchiveAdmissionError(
        'payload-mismatch',
        `resource hash mismatch: ${renderUntrustedName(unit.payload.archivePath)}`
      )
    }
    if (computed.sizeBytes !== unit.payload.sizeBytes) {
      throw new ArchiveAdmissionError(
        'payload-mismatch',
        `resource size mismatch: ${renderUntrustedName(unit.payload.archivePath)}`
      )
    }
    resources.push({
      kind: unit.payload.kind,
      resourceType: unit.payload.resourceType,
      stagedPath,
      livePath: unit.payload.livePath,
      sizeBytes: computed.sizeBytes,
      hash: computed.hash
    })
  }

  // Exact inventory agreement: no staged resource file may be uncovered by the
  // declared units (the ZIP catalog proved this over entries; re-prove it over
  // the extracted bytes).
  for (const file of stagedResourceFiles) {
    if (coverage.covering(file) === null) {
      throw new ArchiveAdmissionError(
        'payload-mismatch',
        `staged resource file not covered by exactly one unit: ${renderUntrustedName(file)}`
      )
    }
  }
  return resources
}
