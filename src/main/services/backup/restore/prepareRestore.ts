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
import { sealResourceInstallEntriesAtArm } from '@data/db/restore/resourceInstallV2'
import {
  clearRestoreJournalV2,
  dbAsideRelPathV2,
  readRestoreJournalV2,
  resourceAsideRootRelPathV2,
  writeRestoreJournalV2
} from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'
import { createKnowledgeRestoreOwnerSummary } from '@main/features/knowledge'
import { renameOnlySync } from '@main/utils/file'

import { admitArchive } from '../admission/admitArchive'
import { RestoreStateError } from '../errors'
import type { BackupManifestDegradation } from '../manifest'
import { currentBackupPlatform } from '../platform'
import { type ManagedRootRebaseTable, prepareManagedRootRebase } from '../portability/managedPathRebase'
import { materializePortableDatabase, summarizeMaterializationDegradations } from '../portability/materializeDatabase'
import { collectResourceRequirements, resolveResourceRoots } from '../resources/collectRequirements'
import { measureResourceCoverage, type ResourceCoverage } from '../resources/coverage'
import { planResourceInstalls } from '../resources/planInstalls'
import { reconcileRestoreResources } from '../resources/reconcile'
import { compactDegradationsForJournal } from './degradationReport'
import { exitForRestoreJournalRecovery } from './restoreTransitionFailure'
import { durabilizeRestoreStaging } from './stagingDurability'

const logger = loggerService.withContext('backupPrepareRestore')

const STAGED_DB_NAME = 'backup.sqlite'
/** Staged payload root inside both the archive and this restore's staging tree. */
const RESOURCES_DIR_NAME = 'resources'

export interface PrepareRestoreInputs {
  /** Untrusted `.cherrybackup` chosen by the user. */
  readonly archivePath: string
  readonly signal?: AbortSignal
}

export interface RestorePreview {
  readonly restoreId: string
  readonly coverage: ResourceCoverage
  /**
   * What the restore would do to this device's files, counted at preparation
   * time (§8). The preboot state machine owns the final result — a target can
   * still appear or vanish before boot.
   */
  readonly resources: { readonly install: number; readonly replace: number }
  /** What materialization reduced, so a degraded restore never looks complete. */
  readonly degradations: readonly BackupManifestDegradation[]
  /** Knowledge owner readiness proven from admitted payload contents. */
  readonly knowledge: { readonly ready: number; readonly rebuild: number }
  /** True when the archive's database was an older chain migrated forward. */
  readonly migratedForward: boolean
}

/** This restore's staging tree, userData-relative (relocation-safe, §6.6). */
function stagingRelDir(restoreId: string): string {
  return `${path.basename(application.getPath('feature.backup.restore.staging'))}/${restoreId}`
}

/** Where this restore's staged database lives, userData-relative. */
function stagedDbRelPath(restoreId: string): string {
  return `${stagingRelDir(restoreId)}/${STAGED_DB_NAME}`
}

/** Where this restore's staged resource payloads live, mirroring the archive's `resources/`. */
function stagedResourcesRelDir(restoreId: string): string {
  return `${stagingRelDir(restoreId)}/${RESOURCES_DIR_NAME}`
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
      'feature.agents.system_workspaces': application.getPath('feature.agents.system_workspaces')
    }
  })
  if (!prepared.ok) {
    throw new Error(`restore preparation cannot rebase managed roots: ${prepared.error.code}`)
  }
  return prepared.table
}

/**
 * Make room for a new preparation, or refuse.
 *
 * The journal is a single slot, so preparing while one exists would silently
 * overwrite it. What that costs depends on the state it is in:
 *
 * - `prepared` is cancellable by contract, and choosing another archive IS a
 *   cancellation, so discard it properly — overwriting would orphan its staging
 *   tree with nothing left pointing at it.
 * - `armed` / `promoting` are past the user's confirmation; a relaunch is
 *   imminent or a promotion is mid-flight, and neither may be redirected.
 * - a terminal journal still owns the previous database and every replaced file
 *   (§6.5). Overwriting it would leave that rollback material unreferenced and
 *   unacknowledgeable, so the user must finish the last restore first.
 */
function clearWayForPreparation(): void {
  const read = readRestoreJournalV2()
  if (read.kind === 'none') return
  if (read.kind === 'corrupt') {
    throw new RestoreStateError('unreadable', 'the restore journal is unreadable and requires explicit repair')
  }
  if (read.journal.state === 'prepared') {
    cancelPreparedRestore()
    return
  }
  throw new RestoreStateError(
    'wrong-state',
    `a restore in state '${read.journal.state}' must be finished before another can be prepared`
  )
}

export async function prepareRestore(inputs: PrepareRestoreInputs): Promise<RestorePreview> {
  const { archivePath, signal } = inputs
  clearWayForPreparation()
  const stagingRoot = application.getPath('feature.backup.restore.staging')

  const admitted = await admitArchive({
    archivePath,
    stagingParent: stagingRoot,
    migrationsFolder: application.getPath('app.database.migrations'),
    signal
  })

  const restoreId = randomUUID()
  let promoted = false
  let journalWritten = false
  try {
    const materialized = await materializePortableDatabase({
      dbPath: admitted.db.path,
      mode: {
        kind: 'restore',
        rebase: buildRebaseTable(admitted.manifest.producer),
        // An archive this install produced describes this install's own
        // filesystem, so its external paths are kept verbatim (§3.1 Layer 1).
        selfAttested: admitted.selfAttested
      },
      signal
    })

    const userDataPath = application.getPath('app.userdata')
    const roots = resolveResourceRoots()
    const inventory = collectResourceRequirements({ dbPath: admitted.db.path, roots, userDataPath })
    const resources = reconcileRestoreResources(admitted.manifest, inventory, admitted.resources)
    const ownerSummary = createKnowledgeRestoreOwnerSummary({
      userDataPath,
      knowledgeRoot: roots.knowledge,
      resources: resources
        .filter((resource) => resource.kind === 'knowledge-base')
        .map((resource) => ({ livePath: resource.livePath, contentPaths: resource.contentPaths }))
    })
    const { coverage } = measureResourceCoverage({ inventory, userDataPath })

    // Decide the whole install plan BEFORE moving anything: a unit that cannot
    // be installed refuses the restore here, where nothing has been touched.
    const plan = planResourceInstalls({
      resources,
      userDataPath,
      roots,
      stagingRelDir: stagedResourcesRelDir(restoreId),
      asideRelDir: resourceAsideRootRelPathV2(restoreId),
      platform: currentBackupPlatform()
    })

    // Move the sealed payloads out of admission's temporary tree and into the
    // deterministic slots the journal names. Same volume, so these are renames;
    // the resource tree moves as ONE unit because its internal layout is what
    // each entry's staging path is relative to.
    const promotePath = path.resolve(userDataPath, stagedDbRelPath(restoreId))
    fs.mkdirSync(path.dirname(promotePath), { recursive: true, mode: 0o700 })
    renameOnlySync(admitted.db.path, promotePath)
    promoted = true
    if (plan.entries.length > 0) {
      renameOnlySync(
        path.join(admitted.stagingDir, RESOURCES_DIR_NAME),
        path.resolve(userDataPath, stagedResourcesRelDir(restoreId))
      )
    }

    // The journal may name this tree only after its platform durability tail:
    // file + directory fsync on POSIX; file fsync and process-crash ordering on
    // Windows, where Node cannot make directory metadata power-loss durable.
    durabilizeRestoreStaging(path.dirname(promotePath))

    // The producer's own reductions PLUS what materializing the archive here
    // reduced (§4). The second half exists only in this process — the staging
    // tree that produced it is gone by the time the report is rendered after the
    // relaunch — so the journal is what carries it across.
    const degradations = [
      ...admitted.manifest.degradations,
      ...summarizeMaterializationDegradations(materialized.summary.degradations, 'restore-db')
    ]

    writeRestoreJournalV2({
      version: 2,
      restoreId,
      preset: admitted.manifest.preset,
      createdAt: new Date().toISOString(),
      state: 'prepared',
      db: {
        promote: stagedDbRelPath(restoreId),
        aside: dbAsideRelPathV2(restoreId),
        chain: materialized.chain.map((entry) => ({ folderMillis: entry.folderMillis, hash: entry.hash }))
      },
      resourceInstalls: [...plan.entries],
      ownerSummary,
      // Persist the bounded presentation, not one line per omitted resource:
      // post-relaunch totals stay exact even when thousands of units share one cause.
      ...(degradations.length > 0 ? { degradations: compactDegradationsForJournal(degradations) } : {})
    })
    journalWritten = true

    logger.info('Restore prepared', {
      restoreId,
      coverage,
      selfAttested: admitted.selfAttested,
      installs: plan.entries.length,
      replacing: plan.replace,
      migratedForward: admitted.migratedForward
    })
    const preview = {
      restoreId,
      coverage,
      resources: { install: plan.install, replace: plan.replace },
      degradations,
      knowledge: {
        ready: ownerSummary.knowledge.readyBaseIds.length,
        rebuild: ownerSummary.knowledge.rebuildBaseIds.length
      },
      migratedForward: admitted.migratedForward
    }
    try {
      await admitted.cleanup()
    } catch (error) {
      // The durable journal now owns the promoted DB/resources. A disposable
      // admission root that was replaced must stay untouched, but its cleanup
      // failure cannot turn a successful preparation into an archive rejection.
      logger.warn('Could not remove admission staging after writing the restore journal; preserving it', error as Error)
    }
    return preview
  } catch (error) {
    // The staged database is only reachable through the journal; without one it
    // is garbage this operation created and must remove.
    if (promoted && !journalWritten) removeStagedRestore(restoreId)
    if (journalWritten) {
      await admitted.cleanup().catch((cleanupError) => {
        logger.warn(
          'Could not remove admission staging after writing the restore journal; preserving it',
          cleanupError as Error
        )
      })
    } else {
      await admitted.cleanup()
    }
    throw error
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
    // Nothing can be proven about what it staged, so preboot preserves it and
    // refuses unsafe startup rather than this path deleting blindly.
    throw new RestoreStateError('unreadable', 'the restore journal is unreadable and requires explicit repair')
  }
  if (read.journal.state !== 'prepared') {
    throw new RestoreStateError(
      'wrong-state',
      `only a prepared restore can be cancelled (state: ${read.journal.state})`
    )
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
export async function armPreparedRestore(expectedRestoreId: string): Promise<void> {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok') {
    throw new RestoreStateError(read.kind === 'corrupt' ? 'unreadable' : 'wrong-state', 'no prepared restore to arm')
  }
  const journal = read.journal
  if (journal.state !== 'prepared') {
    throw new RestoreStateError('wrong-state', `only a prepared restore can be armed (state: ${journal.state})`)
  }
  if (journal.restoreId !== expectedRestoreId) {
    throw new RestoreStateError('wrong-state', 'the prepared restore no longer matches the preview being confirmed')
  }
  if (journal.ownerSummary === undefined) {
    throw new RestoreStateError(
      'wrong-state',
      'this preparation predates owner readiness sealing and must be prepared again'
    )
  }

  const resourceInstalls = sealResourceInstallEntriesAtArm(
    journal.resourceInstalls,
    application.getPath('app.userdata')
  )
  const armed = { ...journal, resourceInstalls: [...resourceInstalls], state: 'armed' as const }
  try {
    writeRestoreJournalV2(armed)
  } catch (error) {
    const committed = readRestoreJournalV2()
    if (
      committed.kind === 'ok' &&
      committed.journal.restoreId === journal.restoreId &&
      committed.journal.state === 'armed'
    ) {
      await exitForRestoreJournalRecovery(error)
    }
    throw error
  }

  logger.info('Restore armed; requesting relaunch', { restoreId: journal.restoreId })
  try {
    application.relaunch()
  } catch (error) {
    try {
      writeRestoreJournalV2(journal)
    } catch (rollbackError) {
      await exitForRestoreJournalRecovery(rollbackError)
    }
    logger.error('Relaunch failed; the arm was rolled back to prepared', error as Error)
    throw new RestoreStateError('relaunch-failed', (error as Error).message)
  }
}
