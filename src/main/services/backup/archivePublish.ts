import { createWriteStream } from 'node:fs'
import { link, lstat, mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'

import { loggerService } from '@logger'
import { ZipArchive } from 'archiver'

import { archiveDurability } from './archiveDurability'
import { DB_ENTRY, MANIFEST_ENTRY, RESOURCES_PREFIX } from './archiveLayout'
import { BACKUP_CEILINGS } from './ceilings'
import { type DirScanLimits, scanDirectoryUnit } from './dirScan'
import {
  BackupCancelledError,
  CeilingExceededError,
  DiskFullError,
  HardLinkUnsupportedError,
  ManifestPayloadMismatchError,
  OutputPathExistsError
} from './errors'
import { hashDirectoryUnit, sha256FileCancellable } from './hashing'
import { type BackupManifest, parseBackupManifest } from './manifest'
import { ResourceCoverageIndex } from './resourceCoverageIndex'
import { validateResourcePathSet } from './resourcePaths'

const logger = loggerService.withContext('backup/archivePublish')

/** Fixed non-resource archive entries the ceilings must reserve: `manifest.json` + `backup.sqlite`. */
const FIXED_ARCHIVE_ENTRIES = 2

/**
 * The producer ceilings `publishArchive` enforces. Defaults to the frozen
 * {@link BACKUP_CEILINGS}; `publishArchiveWithCeilings` accepts a narrowed set so
 * tests can hit exact-at/over boundaries without allocating GiB files.
 */
export interface ProducerCeilings {
  readonly maxArchiveEntries: number
  readonly maxEntryUncompressedBytes: number
  readonly maxTotalUncompressedBytes: number
  readonly maxManifestBytes: number
  readonly maxPathDepth: number
  readonly maxPathLength: number
}

const DEFAULT_PRODUCER_CEILINGS: ProducerCeilings = Object.freeze({
  maxArchiveEntries: BACKUP_CEILINGS.maxArchiveEntries,
  maxEntryUncompressedBytes: BACKUP_CEILINGS.maxEntryUncompressedBytes,
  maxTotalUncompressedBytes: BACKUP_CEILINGS.maxTotalUncompressedBytes,
  maxManifestBytes: BACKUP_CEILINGS.maxManifestBytes,
  maxPathDepth: BACKUP_CEILINGS.maxPathDepth,
  maxPathLength: BACKUP_CEILINGS.maxPathLength
})

/**
 * Atomic, no-clobber, owner-only ZIP publication for the export producer
 * (Phase 1b-i). Work happens inside a freshly-`mkdtemp`'d directory in the
 * destination's directory (same filesystem → atomic hard-link publish), so the
 * only paths this function ever creates or removes are its OWN temp tree — it
 * NEVER unlinks the destination or any sibling. A prior good backup always
 * survives. The published archive is mode `0600`.
 *
 * PRODUCER GUARANTEES OVER THE STAGED RESOURCE TREE. The `resourcesDir` is NOT
 * trusted: before writing, it is walked through the shared {@link scanDirectoryUnit}
 * (same symlink/special/portable/collision/ceiling rules as source staging, with
 * cancellation and no Knowledge exclusion — derived files were dropped during
 * source staging), so a symlinked tree or a staged tree containing
 * symlink/special/unportable/over-ceiling nodes fails closed BEFORE any temp or
 * output exists. Archive-wide ceilings are then enforced with bigint/safe
 * arithmetic: the DB against the per-entry byte ceiling; `manifest + db +
 * aggregate resource bytes ≤ maxTotalUncompressedBytes`; and resource entries +
 * the 2 fixed entries (`manifest.json`, `backup.sqlite`) ≤ `maxArchiveEntries`
 * (reserved via the scanner's entry budget). The DB SHA-256 is computed with a
 * CANCELLABLE stream so a multi-GB verification aborts promptly.
 *
 * ATOMICITY: publication is a single `link()`. A hard-link-hostile volume FAILS
 * CLOSED with {@link HardLinkUnsupportedError} (no non-atomic `copyFile` fallback).
 *
 * DISK PREFLIGHT BOUNDARY: this function does NOT run the shared disk preflight;
 * that is the future export orchestrator's (Phase 2) job. A mid-write `ENOSPC`
 * here surfaces as {@link DiskFullError} as the backstop.
 */

/** No-clobber publish primitive — test seam for the hard-link commit. */
export const publishSeams = {
  hardLink(tmpPath: string, outPath: string): Promise<void> {
    return link(tmpPath, outPath)
  }
}

export interface PublishArchiveInputs {
  /** Destination `.cherrybackup` path (user-chosen). Must NOT already exist. */
  readonly outPath: string
  /** Serialized once to `manifest.json` after strict validation + payload verification. */
  readonly manifest: BackupManifest
  /** Path to the staged DB snapshot → stored as `backup.sqlite`. Verified against the manifest. */
  readonly dbCopyPath: string
  /** Optional staged resource tree → walked + scanned, then stored under `resources/` (Full only). */
  readonly resourcesDir?: string
  readonly signal?: AbortSignal
}

export function publishArchive(inputs: PublishArchiveInputs): Promise<void> {
  return publishArchiveWithCeilings(inputs, DEFAULT_PRODUCER_CEILINGS)
}

async function verifyExactResourceInventory(
  resourcesDir: string,
  manifest: BackupManifest,
  scan: Awaited<ReturnType<typeof scanDirectoryUnit>>,
  limits: DirScanLimits,
  signal: AbortSignal | undefined
): Promise<void> {
  if (manifest.preset !== 'full') throw new ManifestPayloadMismatchError('Lite manifest cannot carry resources')
  const pathSet = validateResourcePathSet(manifest.resourcePayloads.map((payload) => payload.livePath))
  if (!pathSet.ok) {
    throw new ManifestPayloadMismatchError(`resource payload paths are ${pathSet.violation.code}`)
  }

  const units = manifest.resourcePayloads
  for (const payload of units) {
    const expectedArchivePath = `${RESOURCES_PREFIX}${payload.livePath}`
    if (payload.archivePath !== expectedArchivePath) {
      throw new ManifestPayloadMismatchError(
        `resource archivePath ${payload.archivePath} != expected ${expectedArchivePath}`
      )
    }
  }
  const built = ResourceCoverageIndex.build(units, (payload) => ({
    path: payload.livePath,
    isDirectory: payload.resourceType === 'directory'
  }))
  if (!built.ok) {
    throw new ManifestPayloadMismatchError(`resource payload paths are ${built.conflict.kind}`)
  }

  for (const entry of scan.entries) {
    if (built.index.covering(entry.relPath) === null) {
      throw new ManifestPayloadMismatchError(`resource file is undeclared: ${entry.relPath}`)
    }
  }

  for (const dir of scan.dirs) {
    if (!built.index.isStructuralDirectory(dir.relPath)) {
      throw new ManifestPayloadMismatchError(`undeclared resource directory: ${dir.relPath}`)
    }
  }

  for (const payload of units) {
    const stagedPath = path.join(resourcesDir, ...payload.livePath.split('/'))
    const stagedStat = await lstat(stagedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new ManifestPayloadMismatchError(`declared resource is missing: ${payload.livePath}`)
      }
      throw error
    })
    if (payload.resourceType === 'file') {
      if (!stagedStat.isFile() || stagedStat.isSymbolicLink()) {
        throw new ManifestPayloadMismatchError(`declared file is not a regular file: ${payload.livePath}`)
      }
      if (stagedStat.size !== payload.sizeBytes) {
        throw new ManifestPayloadMismatchError(
          `resource size ${stagedStat.size} != manifest ${payload.sizeBytes}: ${payload.livePath}`
        )
      }
      if (((stagedStat.mode & 0o111) !== 0) !== payload.executable) {
        throw new ManifestPayloadMismatchError(`resource executable flag mismatch: ${payload.livePath}`)
      }
      const hash = await sha256FileCancellable(stagedPath, signal)
      if (hash !== payload.hash) {
        throw new ManifestPayloadMismatchError(
          `resource sha256 ${hash} != manifest ${payload.hash}: ${payload.livePath}`
        )
      }
      continue
    }

    if (!stagedStat.isDirectory() || stagedStat.isSymbolicLink()) {
      throw new ManifestPayloadMismatchError(`declared directory is not a real directory: ${payload.livePath}`)
    }
    const hashed = await hashDirectoryUnit(stagedPath, { signal, limits })
    const sizeBytes = hashed.files.reduce((total, file) => total + file.size, 0)
    if (sizeBytes !== payload.sizeBytes || hashed.hash !== payload.hash) {
      throw new ManifestPayloadMismatchError(`directory payload does not match manifest: ${payload.livePath}`)
    }
  }
}

export async function publishArchiveWithCeilings(
  inputs: PublishArchiveInputs,
  ceilings: ProducerCeilings
): Promise<void> {
  const { outPath, manifest, dbCopyPath, resourcesDir, signal } = inputs

  // --- Publication-contract validation (everything provable before writing) ---
  const parsed = parseBackupManifest(manifest)
  if (parsed.kind !== 'ok') throw new Error(`publishArchive: manifest failed strict validation: ${parsed.error}`)
  const validated = parsed.manifest

  // Provable resource-presence shape.
  if (validated.preset === 'lite') {
    if (resourcesDir !== undefined) {
      throw new Error('publishArchive: a Lite archive carries no resources, but a resourcesDir was provided')
    }
  } else {
    const hasPayloads = validated.resourcePayloads.length > 0
    if (hasPayloads !== (resourcesDir !== undefined)) {
      throw new Error(
        `publishArchive: Full resource-presence mismatch (declared payloads=${validated.resourcePayloads.length}, resourcesDir ${resourcesDir === undefined ? 'absent' : 'present'})`
      )
    }
  }

  // Verify the DB payload IS the one the manifest advertises: a regular file of
  // the declared size, within the per-entry ceiling, with the declared SHA-256
  // (cancellable). Fail closed before creating any temp/output.
  const dbStat = await lstat(dbCopyPath)
  if (!dbStat.isFile()) throw new ManifestPayloadMismatchError(`dbCopyPath is not a regular file: ${dbCopyPath}`)
  if (dbStat.size !== validated.db.sizeBytes) {
    throw new ManifestPayloadMismatchError(`db size ${dbStat.size} != manifest ${validated.db.sizeBytes}`)
  }
  if (dbStat.size > ceilings.maxEntryUncompressedBytes) {
    throw new CeilingExceededError('entry-bytes', `db is ${dbStat.size} > ${ceilings.maxEntryUncompressedBytes}`)
  }
  const dbHash = await sha256FileCancellable(dbCopyPath, signal)
  if (dbHash !== validated.db.hash) {
    throw new ManifestPayloadMismatchError(`db sha256 ${dbHash} != manifest ${validated.db.hash}`)
  }

  // Serialize the manifest ONCE; enforce the pre-parse manifest byte cap.
  const manifestBytes = Buffer.from(JSON.stringify(validated, null, 2), 'utf8')
  if (manifestBytes.byteLength > ceilings.maxManifestBytes) {
    throw new CeilingExceededError('manifest-bytes', `${manifestBytes.byteLength} > ${ceilings.maxManifestBytes}`)
  }

  // Walk + scan the (untrusted) staged resource tree through the shared scanner —
  // symlink/special/unportable/collision and per-entry/total ceilings, cancellable,
  // NO Knowledge exclusion (already applied at source staging). The scanner's
  // entry budget reserves the fixed manifest+db entries.
  let resourceTotalBytes = 0n
  if (resourcesDir !== undefined) {
    const scanLimits: DirScanLimits = {
      maxEntries: Math.max(0, ceilings.maxArchiveEntries - FIXED_ARCHIVE_ENTRIES),
      maxEntryBytes: ceilings.maxEntryUncompressedBytes,
      maxTotalBytes: ceilings.maxTotalUncompressedBytes,
      maxPathDepth: ceilings.maxPathDepth,
      maxPathLength: ceilings.maxPathLength
    }
    const resScan = await scanDirectoryUnit(resourcesDir, {
      signal,
      excludeKnowledgeDerivedIndex: false,
      limits: scanLimits
    })
    resourceTotalBytes = resScan.totalBytes
    await verifyExactResourceInventory(resourcesDir, validated, resScan, scanLimits, signal)
  }

  // Archive-wide uncompressed-byte ceiling (bigint — no Number overflow):
  // manifest + db + aggregate resources.
  const aggregateBytes = BigInt(manifestBytes.byteLength) + BigInt(dbStat.size) + resourceTotalBytes
  if (aggregateBytes > BigInt(ceilings.maxTotalUncompressedBytes)) {
    throw new CeilingExceededError('total-bytes', `${aggregateBytes} > ${ceilings.maxTotalUncompressedBytes}`)
  }

  // No-clobber pre-check (the link/EEXIST at publish is the TOCTOU-safe backstop).
  try {
    await stat(outPath)
    throw new OutputPathExistsError(outPath)
  } catch (e) {
    if (e instanceof OutputPathExistsError) throw e
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  if (signal?.aborted) throw new BackupCancelledError()

  // Operation-owned temp DIRECTORY, in the destination's dir (same volume). Nothing
  // outside this tree is ever removed; a name collision cannot truncate a foreign file.
  const tempDir = await mkdtemp(path.join(path.dirname(outPath), '.cherrybackup-tmp-'))
  const tmpFile = path.join(tempDir, 'archive.zip')

  try {
    const archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
    const output = createWriteStream(tmpFile, { flags: 'wx', mode: 0o600 })

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.on('warning', (err: Error & { code?: string }) => {
        reject(new Error(`archiver warning (fatal for a backup archive): ${err.code ?? ''} ${err.message}`))
      })
      const onAbort = (): void => {
        archive.abort()
        reject(new BackupCancelledError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const detach = (): void => signal?.removeEventListener('abort', onAbort)
      output.once('close', detach)
      output.once('error', detach)

      archive.pipe(output)
      archive.append(manifestBytes, { name: MANIFEST_ENTRY })
      archive.file(dbCopyPath, { name: DB_ENTRY })
      if (resourcesDir) archive.directory(resourcesDir, RESOURCES_PREFIX.replace(/\/$/, ''))
      archive.finalize().catch(reject)
    }).catch((e) => {
      archive.abort()
      output.destroy()
      return finished(output)
        .catch(() => {})
        .then(() => {
          throw e
        })
    })

    // Durability BEFORE publish: flush the temp inode.
    await archiveDurability.fsyncFile(tmpFile)

    // Re-check cancellation immediately before the commit point.
    if (signal?.aborted) throw new BackupCancelledError()

    // Single atomic commit. No copy fallback: a hard-link-hostile volume fails closed.
    try {
      await publishSeams.hardLink(tmpFile, outPath)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EEXIST') throw new OutputPathExistsError(outPath)
      if (code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'ENOSYS' || code === 'EPERM' || code === 'EXDEV') {
        throw new HardLinkUnsupportedError(outPath)
      }
      throw e
    }

    // Best-effort durability after the commit (archive already published at 0600).
    try {
      await archiveDurability.fsyncDir(path.dirname(outPath))
    } catch (e) {
      logger.warn('archive published but directory fsync failed', e as Error)
    }
  } catch (e) {
    throw (e as NodeJS.ErrnoException).code === 'ENOSPC' ? new DiskFullError() : e
  } finally {
    // Owned-only cleanup: removes our temp tree (and, on success, the extra hard
    // link — outPath survives). Never touches anything outside tempDir.
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
