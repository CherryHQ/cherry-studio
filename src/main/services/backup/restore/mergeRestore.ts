import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { type AppliedMigration, readAppliedChain } from '@data/db/restore/appliedChain'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { BackupDomain } from '@main/data/db/backup/domains'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import {
  type MergeContext,
  MergeEngine,
  type MergeResult,
  type ReconcileDegradationKind
} from '@main/services/reconciliation'
import { renameOnlySync } from '@main/utils/file'
import type { BackupDegradationCode } from '@shared/ipc/schemas/backup'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { assertNoDbSidecars, sealDetachedDb } from '../dbSeal'
import { BackupCancelledError } from '../errors'
import { sha256FileCancellable } from '../hashing'
import type { ManagedRootRebaseTable } from '../portability/managedPathRebase'
import type { MaterializationSummary } from '../portability/materializeDatabase'

const logger = loggerService.withContext('backupMergeRestore')

/**
 * Merge-mode restore materialization — the second half of the prepare seam.
 *
 * Where ../portability/materializeDatabase rewrites the ARCHIVE's own file into a
 * portable whole-database replacement, this module builds a merged target: the live
 * database is copied with `VACUUM INTO`, the admitted archive database is merged
 * INTO that copy by the reconciliation engine (local rows win, archive rows
 * backfill), and the result is sealed and renamed into the archive's slot. Everything
 * downstream of the seam — coverage, resource planning, the promotion rename, the
 * journal — is source-agnostic and cannot tell the two modes apart.
 *
 * The three properties promotion requires of a staged database hold by construction:
 * the work file is sealed with no `-wal`/`-shm` sidecars, its applied chain is the
 * LIVE chain (the work file starts as a live copy and the merge never touches
 * `__drizzle_migrations` — re-read after the merge to prove it), and the file lands
 * in the admission staging tree the seam's promotion rename already reads from.
 *
 * The work connection deliberately does NOT set `trusted_schema = OFF` the way
 * materialize does: that switch exists for opening attacker-supplied schemas, while
 * this file is a copy of the LIVE database — and the merge's message inserts need
 * the FTS5 sync triggers (whose bodies embed non-innocuous functions and a virtual
 * table) to fire so the search index stays consistent with the merged content.
 *
 * M1 scope (deliberate): resource installs still run the replacement path unchanged,
 * so the engine's staged/skipped resource sets start empty and every imported
 * attachment soft ref is conservatively disclosed. `rebase`/`selfAttested` are
 * carried for seam parity with the replace mode; neither is wired until M2.
 */

/** Which conflict semantics a restore uses. The default is and stays 'replace'. */
export type RestoreMode = 'replace' | 'merge'

export interface MergeRestoreInputs {
  /** The admitted (migrated, sealed) archive database inside admission staging. Overwritten in place. */
  readonly archiveDbPath: string
  /** The live database this install boots from. Read-only source of the work copy. */
  readonly liveDbPath: string
  /** Seam parity with materializePortableDatabase; unwired in M1 (see module doc). */
  readonly rebase: ManagedRootRebaseTable
  /** Seam parity with materializePortableDatabase; unwired in M1 (see module doc). */
  readonly selfAttested: boolean
  /** Domains to merge; defaults to the registry's full set. */
  readonly domains?: readonly BackupDomain[]
  /** Cancels the post-merge hash; the merge transaction itself is synchronous and uninterruptible. */
  readonly signal?: AbortSignal
}

export interface MergeRestoreOutput {
  readonly materialized: MergedDatabase
  /** The merge's own reductions; the same records as `materialized.summary.degradations`. */
  readonly degradations: readonly MergeDegradation[]
}

/**
 * One merged-out reduction. Same table/rowId/reason shape as the materialize
 * side, but the reason carries a BACKUP_DEGRADATION_CODES entry ('merge_*') —
 * the closed vocabulary the journal and the renderer's disclosure map consume.
 */
export interface MergeDegradation {
  readonly table: string
  readonly rowId: string
  readonly reason: BackupDegradationCode
}

/** Same shape as {@link MaterializedDatabase}, with merge-code degradation reasons. */
export interface MergedDatabase {
  readonly summary: Omit<MaterializationSummary, 'degradations'> & {
    readonly degradations: readonly MergeDegradation[]
  }
  /** SHA-256 of the sealed merged file — the identity the restore journal names. */
  readonly hash: string
  readonly sizeBytes: number
  /** The live chain, proven unchanged by the merge (a bundled prefix by construction). */
  readonly chain: readonly AppliedMigration[]
}

/**
 * Engine-side reconciliation loss → user-facing degradation code. Identity mapping
 * except `remote_overwrote_local`: for a restore the "remote" side IS the backup,
 * so the code says so (the engine's kind is deliberately consumer-neutral).
 */
const MERGE_DEGRADATION_CODES: Record<ReconcileDegradationKind, BackupDegradationCode> = {
  ref_cleared: 'merge_ref_cleared',
  row_pruned: 'merge_row_pruned',
  rows_skipped: 'merge_rows_skipped',
  association_dropped: 'merge_association_dropped',
  field_conflict: 'merge_field_conflict',
  remote_overwrote_local: 'merge_backup_overwrote_local',
  attachment_unavailable: 'merge_attachment_unavailable',
  resource_content_missing: 'merge_resource_content_missing'
}

/**
 * The finalized 14-domain registry. {@link contributorManager} is the process-wide
 * lazy singleton: the 27-invariant finalize runs once, on the first merge.
 */
function mergeRegistry(): ReadonlyBackupRegistry {
  return contributorManager.getRegistry()
}

function buildMergeContext(inputs: MergeRestoreInputs, domains: readonly BackupDomain[]): MergeContext {
  return {
    backupDbPath: inputs.archiveDbPath,
    domains,
    // M1 resource sets start empty: installs still run the replacement path, so the
    // merge cannot know which blobs landed — every imported attachment soft ref is
    // conservatively disclosed. TODO(m2): feed planResourceInstalls' staged/skipped sets in.
    skippedFileEntryIds: new Set<string>(),
    stagedFileEntryIds: new Set<string>()
  }
}

/** Copy the live database into a fresh work file beside the admitted archive database. */
function vacuumLiveIntoWork(liveDbPath: string, workPath: string): void {
  const live = new Database(liveDbPath, { readonly: true, fileMustExist: true })
  try {
    // VACUUM INTO takes the target as a text literal; double any single quotes.
    live.exec(`VACUUM INTO '${workPath.replace(/'/g, "''")}'`)
  } finally {
    live.close()
  }
}

/**
 * Fan one aggregated engine loss out to per-row records.
 *
 * `DegradedSkip` arrives pre-aggregated with a count, while the shared summarizer
 * re-derives counts from per-row entries — this fan-out is what keeps the journal's
 * totals exact. Transient and bounded by the archive's ceiling-capped row counts.
 */
function expandDegradedSkips(result: MergeResult): MergeDegradation[] {
  return result.degradedToSkips.flatMap((skip) =>
    Array.from({ length: skip.count }, () => ({
      table: skip.table,
      // Pre-aggregated: no single row id exists, and the summarizer never surfaces one.
      rowId: '',
      reason: MERGE_DEGRADATION_CODES[skip.kind]
    }))
  )
}

/** The replace mode's counters are archive-processing counts; a merge runs none of them. */
function mergeSummary(degradations: readonly MergeDegradation[]): MergedDatabase['summary'] {
  return {
    activeJobsDeleted: 0,
    schedulesDisabled: 0,
    mcpServersSanitized: 0,
    agentsSanitized: 0,
    channelsSanitized: 0,
    knowledgeItemsReset: 0,
    externalFileEntriesDeleted: 0,
    preferencesDeleted: 0,
    codeCliConfigsRewritten: 0,
    codeCliConfigsDeleted: 0,
    pathsRebased: 0,
    pathsExternal: 0,
    degradations
  }
}

/**
 * Build the merged database for a merge-mode restore and put it in the archive's
 * slot, ready for the seam's remaining steps (coverage → planning → promotion rename).
 *
 * Any failure before the final rename leaves the admitted archive untouched and the
 * work file removed; admission staging continues under admission's own cleanup.
 */
export async function materializeMergedDatabase(inputs: MergeRestoreInputs): Promise<MergeRestoreOutput> {
  if (inputs.signal?.aborted) throw new BackupCancelledError()

  const domains = inputs.domains ?? mergeRegistry().domains
  const workPath = path.join(path.dirname(inputs.archiveDbPath), `merge-work-${randomUUID()}.sqlite`)
  try {
    vacuumLiveIntoWork(inputs.liveDbPath, workPath)

    const work = new Database(workPath, { fileMustExist: true })
    let result: MergeResult
    let chain: readonly AppliedMigration[]
    try {
      const workDb: DbType = drizzle({ client: work, casing: 'snake_case' })
      result = await new MergeEngine(mergeRegistry()).mergeBackupIntoWork(
        work,
        workDb,
        buildMergeContext(inputs, domains)
      )
      // Prove the merge never disturbed the applied chain: the work file started as a
      // live copy, so this chain is the live one — a bundled prefix by construction.
      chain = readAppliedChain(work)
      sealDetachedDb(work)
    } finally {
      work.close()
    }

    assertNoDbSidecars(workPath)
    const hash = await sha256FileCancellable(workPath, inputs.signal)
    const sizeBytes = (await stat(workPath)).size

    // Take over the admitted DB's slot: same staging volume, so this is a rename —
    // from here on the merged database IS what the seam's promotion renames.
    renameOnlySync(workPath, inputs.archiveDbPath)

    const degradations = expandDegradedSkips(result)
    const materialized = { summary: mergeSummary(degradations), hash, sizeBytes, chain }
    logger.info('Merge-mode materialization finished', {
      domains: domains.length,
      degradations: degradations.length,
      sizeBytes
    })
    return { materialized, degradations }
  } catch (error) {
    // A no-op once the rename succeeded (the file has moved); garbage otherwise.
    fs.rmSync(workPath, { force: true })
    throw error
  }
}
