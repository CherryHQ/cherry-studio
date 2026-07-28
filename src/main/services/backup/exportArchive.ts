/**
 * Export orchestrator (docs/references/backup/README.md §2, §5).
 *
 * Composes primitives that were each proved on their own in Phase 1 into the
 * one sequence that produces a `.cherrybackup`:
 *
 * ```text
 * snapshotTo → materializePortableDatabase → collectResourceRequirements
 *            → manifest → assertDiskHeadroom → publishArchive
 * ```
 *
 * Order is load-bearing. The materializer SEALS the artifact and returns its
 * hash and size; everything after reads that artifact without touching it, so
 * the manifest's `db.hash` is the hash of the exact bytes the archive carries.
 * Recomputing it later would only create a window where the two could disagree.
 *
 * The orchestrator owns exactly one directory — a fresh `mkdtemp` under
 * `feature.backup.temp` — and removes only that. It never deletes the
 * destination or anything it did not create; a prior good backup always
 * survives (`publishArchive` enforces no-clobber independently).
 *
 * Full inserts one step — resource staging — between the requirements and the
 * manifest, and everything else is identical: the same snapshot, the same
 * materialization, the same publication. That is the whole difference between
 * the presets (§2), so they share this function rather than forking it.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { loggerService } from '@logger'
import { profileMutationBarrier } from '@main/core/concurrency/ProfileMutationBarrier'
import Database from 'better-sqlite3'
import { app } from 'electron'

import { publishArchive } from './archivePublish'
import { assertDiskHeadroom } from './diskPreflight'
import { BackupCancelledError } from './errors'
import { BACKUP_FORMAT_VERSION, type BackupManifest, type BackupPreset, type ManagedRootIdentity } from './manifest'
import { currentBackupPlatform } from './platform'
import { REBASABLE_MANAGED_ROOT_KEYS } from './portability/managedPathRebase'
import type { MaterializationSummary } from './portability/materializeDatabase'
import { materializePortableDatabase, summarizeMaterializationDegradations } from './portability/materializeDatabase'
import { collectResourceRequirements } from './resources/collectRequirements'
import { captureResourceStageBaseline, type ResourceStageBaseline, stageResources } from './resources/stageResources'

const logger = loggerService.withContext('backupExport')

const STAGED_DB_NAME = 'backup.sqlite'
/** Staged payload root; published as the archive's `resources/` prefix. */
const RESOURCES_DIR_NAME = 'resources'

export interface ExportArchiveInputs {
  /** Destination `.cherrybackup` path. Must not already exist. */
  readonly outPath: string
  /** `lite` carries the database alone; `full` adds the managed resource overlay (§2). */
  readonly preset: BackupPreset
  readonly signal?: AbortSignal
}

export interface ExportArchiveResult {
  readonly outPath: string
  readonly manifest: BackupManifest
  /** What materialization changed, for the export report (§4). */
  readonly summary: MaterializationSummary
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError('backup export cancelled')
}

/**
 * The producer's managed-root identities, without which a cross-device restore
 * cannot rebase `note.rootPath` or `agent_workspace.path`.
 *
 * Exactly the roots the rebaser knows how to consume — declaring more would
 * widen what an archive can later redirect on the target, for no gain.
 */
function producerManagedRoots(): ManagedRootIdentity[] {
  return REBASABLE_MANAGED_ROOT_KEYS.map((key) => ({ key, path: application.getPath(key) }))
}

/** Read the sealed artifact's applied chain without modifying it. */
function readSealedChain(dbPath: string): ReturnType<typeof readAppliedChain> {
  const sqlite = new Database(dbPath, { fileMustExist: true, readonly: true })
  try {
    return readAppliedChain(sqlite)
  } finally {
    sqlite.close()
  }
}

export async function exportArchive(inputs: ExportArchiveInputs): Promise<ExportArchiveResult> {
  const { outPath, preset, signal } = inputs
  throwIfAborted(signal)

  const stagingRoot = await mkdtemp(path.join(application.getPath('feature.backup.temp'), 'export-'))
  try {
    const stagedDbPath = path.join(stagingRoot, STAGED_DB_NAME)

    // Preflight the STAGING volume against the live database's size: the
    // snapshot is a `VACUUM INTO` copy, so it is at most that large. Doing this
    // before the copy turns a full disk into an actionable error instead of a
    // half-written snapshot.
    const dbService = application.get('DbService')
    const liveDbBytes = (await stat(application.getPath('app.database.file'))).size
    await assertDiskHeadroom({ target: stagingRoot, neededBytes: liveDbBytes })

    const userDataPath = application.getPath('app.userdata')
    let snapshotRequirements: ReturnType<typeof collectResourceRequirements>['requirements'] = []
    let resourceBaseline: ResourceStageBaseline | undefined
    if (preset === 'full') {
      // This is the cross-store consistency point: wait for complete managed
      // DB↔FS mutations, freeze new ones, snapshot SQLite, then capture the
      // identity of every resource named by that snapshot. Expensive byte copies
      // happen after release and must still match this baseline.
      await profileMutationBarrier.runSnapshot(async () => {
        dbService.createSnapshot(stagedDbPath)
        const snapshotInventory = collectResourceRequirements({ dbPath: stagedDbPath })
        snapshotRequirements = snapshotInventory.requirements
        resourceBaseline = await captureResourceStageBaseline({
          requirements: snapshotRequirements,
          userDataPath,
          signal
        })
      })
    } else {
      dbService.createSnapshot(stagedDbPath)
    }
    throwIfAborted(signal)

    const materialized = await materializePortableDatabase({ dbPath: stagedDbPath, mode: { kind: 'export' }, signal })
    throwIfAborted(signal)

    const inventory = collectResourceRequirements({ dbPath: stagedDbPath })
    if (preset === 'full' && JSON.stringify(inventory.requirements) !== JSON.stringify(snapshotRequirements)) {
      throw new Error('portable database materialization changed the managed resource closure')
    }

    // Full only. The baseline was captured while the database snapshot boundary
    // was frozen; staging later proves every copied unit still has that identity.
    const resourcesDir = path.join(stagingRoot, RESOURCES_DIR_NAME)
    if (resourceBaseline) {
      await assertDiskHeadroom({ target: stagingRoot, neededBytes: resourceBaseline.totalBytes })
    }
    const resources =
      preset === 'full'
        ? await stageResources({
            requirements: inventory.requirements,
            userDataPath,
            resourcesDir,
            baseline: resourceBaseline,
            signal
          })
        : null
    throwIfAborted(signal)

    const common = {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      producer: {
        appVersion: app.getVersion(),
        platform: currentBackupPlatform(),
        managedRoots: producerManagedRoots()
      },
      migrationChain: readSealedChain(stagedDbPath),
      db: { hash: materialized.hash, sizeBytes: materialized.sizeBytes },
      resourceRequirements: [...inventory.requirements],
      degradations: [
        ...summarizeMaterializationDegradations(materialized.summary.degradations, 'portable-db'),
        ...(resources?.degradations ?? [])
      ]
    }
    const manifest: BackupManifest = resources
      ? { ...common, preset: 'full', resourcePayloads: [...resources.payloads] }
      : { ...common, preset: 'lite' }

    const resourceBytes = resources?.payloads.reduce((sum, payload) => sum + payload.sizeBytes, 0) ?? 0
    // Preflight the DESTINATION volume separately — it is frequently a
    // different one (an external drive), and the archive is written there.
    await assertDiskHeadroom({ target: outPath, neededBytes: materialized.sizeBytes + resourceBytes })

    await publishArchive({
      outPath,
      manifest,
      dbCopyPath: stagedDbPath,
      resourcesDir: resources?.staged ? resourcesDir : undefined,
      signal
    })

    logger.info('Archive exported', {
      preset,
      requirements: inventory.requirements.length,
      unverifiable: inventory.unverifiableByKind,
      payloads: resources?.payloads.length ?? 0,
      degradations: manifest.degradations.length,
      dbSizeBytes: materialized.sizeBytes,
      resourceBytes
    })

    return { outPath, manifest, summary: materialized.summary }
  } finally {
    // Owned tree only. `force` keeps cleanup idempotent when a failure happened
    // before anything was written into it.
    await rm(stagingRoot, { recursive: true, force: true })
  }
}
