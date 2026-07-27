/**
 * Restore preparation, cancellation, and arming (docs/references/backup/README.md
 * §2, §6.1).
 *
 * This is the export path in reverse, and it stops one step short of doing
 * anything irreversible:
 *
 * ```text
 * admitArchive → prepareManagedRootRebase → materializePortableDatabase
 *              → coverage → writeRestoreJournalV2({state:'prepared'})
 * ```
 *
 * NOTHING here mutates live state. `prepared` is not permission to restore — it
 * is a staged database plus a cancellable marker. Only {@link armPreparedRestore}
 * turns it into a promotion, and only immediately before the relaunch that
 * performs it, so an unrelated restart can never resurrect a preparation the
 * user walked away from (the preboot gate expires it instead, Phase 2d).
 *
 * Coverage is the ONE place existence checking is both correct and required: it
 * answers "will this device have the files the restored database points at",
 * which is a question about the target and nothing else. It is diagnostic —
 * nothing here creates, modifies, or deletes an authoritative resource file.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { clearRestoreJournalV2, readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'

import { admitArchive } from './admission/admitArchive'
import type { BackupManifestDegradation, BackupPreset } from './manifest'
import { currentBackupPlatform } from './platform'
import { type ManagedRootRebaseTable, prepareManagedRootRebase } from './portability/managedPathRebase'
import { materializePortableDatabase } from './portability/materializeDatabase'
import { collectResourceRequirements } from './resources/collectRequirements'

const logger = loggerService.withContext('backupPrepareRestore')

const STAGED_DB_NAME = 'backup.sqlite'

export interface PrepareRestoreInputs {
  /** Untrusted `.cherrybackup` chosen by the user. */
  readonly archivePath: string
  readonly signal?: AbortSignal
}

/**
 * Existence coverage of the restored database's resource references on THIS
 * device (§2). Deliberately counts only — it makes no content-equality claim,
 * and it never hashes a target file.
 */
export interface ResourceCoverage {
  /** The declared path exists with the declared type. */
  readonly available: number
  /** Absent, or present with the wrong type (a file where a directory belongs). */
  readonly missing: number
  /** External user paths the archive can never own, so no claim is possible (§4). */
  readonly unverifiable: number
}

export interface RestorePreview {
  readonly restoreId: string
  readonly preset: BackupPreset
  readonly coverage: ResourceCoverage
  /** What materialization reduced, so a degraded restore never looks complete. */
  readonly degradations: readonly BackupManifestDegradation[]
  /** True when the archive's database was an older chain migrated forward. */
  readonly migratedForward: boolean
}

/** Where this restore's staged database lives, userData-relative (relocation-safe, §6.6). */
function stagedDbRelPath(restoreId: string): string {
  return `${path.basename(application.getPath('feature.backup.restore.staging'))}/${restoreId}/${STAGED_DB_NAME}`
}

/**
 * Park slot for the live database, named per restore.
 *
 * A fixed name would let a stale aside from an earlier restore be mistaken for
 * this one's rollback source — the recovery table decides from `(staged, live,
 * aside)` existence, so an aside that belongs to a different restore is worse
 * than no aside at all.
 */
function dbAsideRelPath(restoreId: string): string {
  return `${path.basename(application.getPath('app.database.file'))}.pre-restore-${restoreId}`
}

/** Target-side rebase table, resolved once per restore from the trusted registry. */
function buildRebaseTable(producer: {
  platform: 'darwin' | 'win32' | 'linux'
  managedRoots: readonly { key: string; path: string }[]
}): ManagedRootRebaseTable {
  const prepared = prepareManagedRootRebase({
    producerPlatform: producer.platform,
    producerRoots: producer.managedRoots,
    targetPlatform: currentBackupPlatform(),
    targetRoots: {
      'feature.notes.data': application.getPath('feature.notes.data'),
      'feature.agents.workspaces': application.getPath('feature.agents.workspaces')
    }
  })
  if (!prepared.ok) {
    throw new Error(`restore preparation cannot rebase managed roots: ${prepared.error.code}`)
  }
  return prepared.table
}

/**
 * Count how many declared resources this device already has.
 *
 * `lstat` rather than `stat`: a symlink standing where a managed resource
 * belongs is not that resource, and following it would report content Cherry
 * does not own as available. A wrong-typed entry counts as missing for the same
 * reason — the restored database cannot use it.
 */
function measureCoverage(userDataPath: string, stagedDbPath: string): ResourceCoverage {
  const inventory = collectResourceRequirements({ dbPath: stagedDbPath })
  let available = 0
  let missing = 0

  for (const requirement of inventory.requirements) {
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(path.resolve(userDataPath, requirement.livePath))
    } catch {
      missing++
      continue
    }
    const matches = requirement.resourceType === 'file' ? stats.isFile() : stats.isDirectory()
    if (matches) available++
    else missing++
  }

  const unverifiable = Object.values(inventory.unverifiableByKind).reduce((sum, count) => sum + count, 0)
  return { available, missing, unverifiable }
}

export async function prepareLiteRestore(inputs: PrepareRestoreInputs): Promise<RestorePreview> {
  const { archivePath, signal } = inputs
  const stagingRoot = application.getPath('feature.backup.restore.staging')

  const admitted = await admitArchive({
    archivePath,
    stagingParent: stagingRoot,
    migrationsFolder: application.getPath('app.database.migrations'),
    signal
  })

  const restoreId = randomUUID()
  let promoted = false
  try {
    if (admitted.manifest.preset !== 'lite') {
      throw new Error(`this build prepares Lite archives only; got preset '${admitted.manifest.preset}'`)
    }

    const materialized = await materializePortableDatabase({
      dbPath: admitted.db.path,
      mode: { kind: 'restore', rebase: buildRebaseTable(admitted.manifest.producer) },
      signal
    })

    const userDataPath = application.getPath('app.userdata')
    const coverage = measureCoverage(userDataPath, admitted.db.path)

    // Move the sealed database out of admission's temporary tree and into the
    // deterministic slot the journal names. Same volume, so this is a rename.
    const promotePath = path.resolve(userDataPath, stagedDbRelPath(restoreId))
    fs.mkdirSync(path.dirname(promotePath), { recursive: true })
    fs.renameSync(admitted.db.path, promotePath)
    promoted = true

    writeRestoreJournalV2({
      version: 2,
      restoreId,
      preset: 'lite',
      createdAt: new Date().toISOString(),
      state: 'prepared',
      db: {
        promote: stagedDbRelPath(restoreId),
        aside: dbAsideRelPath(restoreId),
        chain: materialized.chain.map((entry) => ({ folderMillis: entry.folderMillis, hash: entry.hash }))
      },
      resourceInstalls: []
    })

    const degradations = admitted.manifest.degradations
    logger.info('Restore prepared', { restoreId, coverage, migratedForward: admitted.migratedForward })
    return { restoreId, preset: 'lite', coverage, degradations, migratedForward: admitted.migratedForward }
  } catch (error) {
    // The staged database is only reachable through the journal; without one it
    // is garbage this operation created and must remove.
    if (promoted) removeStagedRestore(restoreId)
    throw error
  } finally {
    await admitted.cleanup()
  }
}

/** Remove one restore's staged tree. Idempotent; touches nothing outside it. */
function removeStagedRestore(restoreId: string): void {
  const dir = path.join(application.getPath('feature.backup.restore.staging'), restoreId)
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * Discard a preparation: staging tree first, journal last.
 *
 * That order is the same invariant acknowledgement uses — while the journal
 * exists the staged tree is protected, so removing the journal first would
 * orphan the tree with nothing left pointing at it. Idempotent, so a crash
 * between the two steps is resumable by calling this again.
 *
 * Only `prepared` may be cancelled. An `armed` or later journal is already past
 * the user's confirmation and belongs to the promotion gate.
 */
export function cancelPreparedRestore(): void {
  const read = readRestoreJournalV2()
  if (read.kind === 'none') return
  if (read.kind === 'corrupt') {
    // Nothing can be proven about what it staged, so the promotion gate
    // quarantines it at the next boot rather than this path deleting blindly.
    throw new Error('the restore journal is unreadable; the next boot will quarantine it')
  }
  if (read.journal.state !== 'prepared') {
    throw new Error(`only a prepared restore can be cancelled (state: ${read.journal.state})`)
  }

  removeStagedRestore(read.journal.restoreId)
  clearRestoreJournalV2()
  logger.info('Prepared restore cancelled', { restoreId: read.journal.restoreId })
}

/**
 * Confirm a preparation and relaunch into it.
 *
 * `armed` is written durably BEFORE relaunch is initiated — the marker is what
 * the preboot gate acts on, and a relaunch that beat its own marker to disk
 * would boot into an unarmed preparation and expire it.
 *
 * If relaunch initiation fails the arm is rolled back to `prepared` rather than
 * left in place: an armed journal that nothing is about to consume would promote
 * on the user's next unrelated restart, turning a failed button press into a
 * surprise database replacement.
 */
export function armPreparedRestore(): void {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok') {
    throw new Error('no prepared restore to arm')
  }
  const journal = read.journal
  if (journal.state !== 'prepared') {
    throw new Error(`only a prepared restore can be armed (state: ${journal.state})`)
  }

  writeRestoreJournalV2({ ...journal, state: 'armed' })
  try {
    application.relaunch()
  } catch (error) {
    writeRestoreJournalV2(journal)
    logger.error('Relaunch failed; the arm was rolled back to prepared', error as Error)
    throw error
  }
  logger.info('Restore armed; relaunching', { restoreId: journal.restoreId })
}
