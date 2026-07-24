// ImportOrchestrator — the restore (C-import) staging spine.
//
// Mirrors ExportOrchestrator's shape but runs the inverse pipeline on a detached
// `work.sqlite` (a VACUUM INTO copy of live): quiesce → capture live fingerprint →
// createSnapshot → merge backup rows → applyMigrations → seal → second fingerprint
// → write staged journal. The live DB is never written during a restore; the preboot
// promotion gate (#16884, already wired) swaps `work.sqlite` in by atomic rename on
// the next launch.
//
// Crash-safety contract (#16884 README "Writer requirements (staging side)"):
//  1. db.fingerprint captured on the live connection AFTER quiesce, BEFORE snapshot.
//  2. work.sqlite sealed (checkpointTruncateAssert + close + assert no -wal/-shm).
//  3. db.chain from readAppliedChain(work), never from the bundled migration list.
//  4. add-target livePaths must not pre-exist (enforced at promotion admission).
//
// Resource planning runs after snapshot and before merge so skipped* sets are
// merge inputs (no dangling file_entry / knowledge_base / skill rows). Journal
// fileResources come from the plan (additive only); skips stay in-memory for
// RestoreResultSummary (B4), not in the journal schema.

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { applyMigrations } from '@main/data/db/applyMigrations'
import type { DbService } from '@main/data/db/DbService'
import { type AppliedMigration, readAppliedChain } from '@main/data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { readRestoreJournal, type RestoreJournal, writeRestoreJournal } from '@main/data/db/restore/restoreJournal'
import type { DbType } from '@main/data/db/types'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { ArchiveContext } from './admitArchive'
import { BackupCancelledError, RestoreFingerprintMismatchError } from './errors'
import { captureLiveFingerprint } from './fingerprintProducer'
import type { MergeContext, MergeResult } from './merge/types'
import { presetIncludesFiles } from './presets'
import type { PlanCtx, PlanRoots, ResourcePlan } from './resourcePlanning'

const logger = loggerService.withContext('ImportOrchestrator')

/** Progress phase names emitted to the caller (mirrors ExportOrchestrator's emitProgress). */
export type ImportPhase =
  | 'admission'
  | 'quiesce'
  | 'fingerprint'
  | 'snapshot'
  | 'merge'
  | 'migrate'
  | 'seal'
  | 'stage'
  | 'verify'
  | 'journal'

export interface ImportProgressUpdate {
  readonly phase: ImportPhase
  readonly current: number
  readonly total: number
  readonly message?: string
}

export interface ImportBackupOptions {
  /** Absolute path to the source .cherrybackup archive (untrusted input — archive admission validates it). */
  readonly archivePath: string
  /** Caller-generated restore id; MUST be a safe basename (used as the staging subtree name). */
  readonly restoreId: string
  readonly onProgress?: (update: ImportProgressUpdate) => void
  readonly signal?: AbortSignal
}

export interface ImportBackupResult {
  readonly restoreId: string
  /** Absolute path the staged journal was written to (for diagnostics; the gate reads it via the path key). */
  readonly journalPath: string
  /** Planning skips / toRestore for relaunch-confirm disclosure (B4); not written into the journal. */
  readonly plan: Pick<ResourcePlan, 'skips' | 'toRestore' | 'resources'>
}

/**
 * Collaborators for the restore spine. `planResources` runs after snapshot and
 * before merge (P0-4); journal.fileResources come from the plan (no stage stub).
 */
export interface ImportOrchestratorDeps {
  readonly dbService: DbService
  readonly migrationsFolder: string
  /** Absolute path to the live DB main file (app.database.file). */
  readonly liveDbPath: string
  /** Absolute path to the restore staging root (feature.backup.restore.staging). */
  readonly restoreStagingRoot: string
  /** Absolute path to userData — journal paths are stored relative to this. */
  readonly userData: string
  /** Archive admission — validate + safely unpack the .cherrybackup into the staging subtree BEFORE quiesce (backup-architecture §9 step 0). */
  readonly admitArchive: (archivePath: string, workDir: string, migrationsFolder: string) => Promise<ArchiveContext>
  /** Quiesce all main-side writers + renderer mutation admission. */
  readonly quiesceWriters: (signal?: AbortSignal) => Promise<void>
  /** Merge backup rows into the detached work.sqlite. */
  readonly mergeBackupIntoWork: (
    workSqlite: Database.Database,
    workDb: DbType,
    ctx: MergeContext
  ) => Promise<MergeResult>
  /**
   * Resource planning (merge input + journal resources). Caller supplies roots via
   * {@link planRoots}; the orchestrator builds {@link PlanCtx} after snapshot.
   */
  readonly planResources: (ctx: PlanCtx) => ResourcePlan
  /** Live FS roots for planning livePath resolution + containment. */
  readonly planRoots: PlanRoots
  /** Absolute path to the restore journal file (feature.backup.restore.file). */
  readonly journalPath: string
}

/** RestoreId must be a safe basename — it becomes a directory under the staging root. */
function isSafeBasename(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) && !id.includes('..') && id !== '.' && id !== '..'
}

export class ImportOrchestrator {
  constructor(private readonly deps: ImportOrchestratorDeps) {}

  /**
   * Run the restore staging spine. On success a `staged` journal exists on disk and
   * the caller (BackupService) triggers a relaunch so the preboot gate promotes it.
   * On any failure the journal is NOT written and staging residue is cleaned up
   * (the startup GC is the backstop if cleanup itself crashes — see plan (h)).
   */
  async importBackup(options: ImportBackupOptions): Promise<ImportBackupResult> {
    if (!isSafeBasename(options.restoreId)) {
      throw new Error(`importBackup: invalid restoreId (must be a safe basename): ${options.restoreId}`)
    }
    this.assertNotCancelled(options)

    const workDir = path.join(this.deps.restoreStagingRoot, options.restoreId)
    const workPath = path.join(workDir, 'work.sqlite')
    // aside sits next to the live DB (same dir → atomic rename at promotion).
    const asideAbs = `${this.deps.liveDbPath}.aside-${options.restoreId}`

    // Track the open work connection so the finally block can close it on a mid-pipeline failure.
    let workSqlite: Database.Database | undefined
    let committed = false

    try {
      this.emit(options, 'admission', 0, 1, 'archive admission + staging prep')
      // (横切) Archive admission — validate + safely unpack the .cherrybackup into the staging subtree
      // BEFORE quiesce (backup-architecture §9 step 0): format gate + schema comparison +
      // migrate-forward + integrity_check (admitArchive.ts). ArchiveContext bound here feeds
      // the merge ctx (backupDbPath + domains) at step (b) below.
      const archiveContext = await this.deps.admitArchive(options.archivePath, workDir, this.deps.migrationsFolder)
      this.assertNotCancelled(options)
      // Prepare the staging subtree: work.sqlite must NOT exist (snapshotTo asserts this).
      fs.mkdirSync(workDir, { recursive: true })
      if (fs.existsSync(workPath)) {
        throw new Error(`importBackup: work.sqlite already exists (interrupted prior restore?): ${workPath}`)
      }
      // aside is the live-DB rename target at promotion — must not pre-exist (a stale aside
      // from an unclean crash would make the gate's rename fail). Mirrors #16884 "add-targets
      // must not pre-exist".
      if (fs.existsSync(asideAbs)) {
        throw new Error(`importBackup: aside target already exists (unclean prior restore?): ${asideAbs}`)
      }

      // (a) Quiesce — drain verdict MUST precede createSnapshot (#16850 Q3c precondition).
      this.emit(options, 'quiesce', 0, 1, 'draining in-flight writers')
      await this.deps.quiesceWriters(options.signal)
      this.assertNotCancelled(options)

      // (c) Capture the live fingerprint AFTER quiesce, BEFORE snapshot. busy==0 holds
      // (single connection, writers drained); the value is carried in memory to the
      // staged journal — a preboot-consumable journal must never exist before staging
      // is complete and sealed (#16884 README Writer requirements item 1).
      this.emit(options, 'fingerprint', 0, 1, 'capturing live DB fingerprint')
      const fingerprint = await captureLiveFingerprint(this.deps.dbService, this.deps.liveDbPath)
      this.assertNotCancelled(options)

      // (c) createSnapshot — VACUUM INTO live → work. A read transaction: leaves the
      // live main file untouched, so the captured fingerprint stays valid and work is
      // built from exactly the fingerprinted state.
      this.emit(options, 'snapshot', 0, 1, 'snapshotting live DB into work.sqlite')
      this.deps.dbService.createSnapshot(workPath)
      this.assertNotCancelled(options)

      // (e') Plan resources AFTER snapshot and BEFORE opening the write work connection
      // (P0-4). planResources opens work.sqlite readonly itself and closes in finally —
      // never share a write handle with planning. Skipped* sets feed merge; resources
      // become journal.fileResources. Skips stay in-memory for B4 disclosure.
      this.emit(options, 'stage', 0, 1, 'planning file resources')
      const plan = this.deps.planResources({
        manifest: archiveContext.manifest,
        workDir,
        backupDbPath: archiveContext.backupDbPath,
        workPath,
        userData: this.deps.userData,
        roots: this.deps.planRoots
      })
      this.assertNotCancelled(options)

      // Open the detached work connection. VACUUM INTO copies the live DB's header (including
      // its WAL journal_mode flag), so explicitly switch work to DELETE mode before any
      // merge/migrate write — the gate renames only the main file, so work must carry no
      // -wal/-shm sidecars (the seal below is the belt-and-suspenders backstop).
      workSqlite = new Database(workPath)
      workSqlite.pragma('journal_mode = DELETE')
      const workDb = drizzle({ client: workSqlite, casing: 'snake_case' })

      // (b) Merge backup rows into work. FIELD_MERGE (natural-key) / SKIP (uuid-entity) +
      // dangling-ref repair. skipped* sets from planning prune file_entry / knowledge_base /
      // skill roots whose blobs/dirs were not staged. stagedFileEntryIds drives message.data
      // fileEntryId soft-ref disclosure. includeFiles uses presetIncludesFiles(preset) (P0-3)
      // — not archiveContext.includeFiles (export may set includeFiles from filesTotal>0).
      // userStrategy omitted → per-aggregate conflictDefault.
      this.emit(options, 'merge', 0, 1, 'merging backup rows into work.sqlite')
      const ctx: MergeContext = {
        backupDbPath: archiveContext.backupDbPath,
        domains: archiveContext.domains,
        skippedFileEntryIds: plan.skippedFileEntryIds,
        stagedFileEntryIds: plan.stagedFileEntryIds,
        skippedKnowledgeBaseIds: plan.skippedKnowledgeBaseIds,
        skippedSkillFolderNames: plan.skippedSkillFolderNames,
        includeFiles: presetIncludesFiles(archiveContext.manifest.preset)
      }
      const result = await this.deps.mergeBackupIntoWork(workSqlite, workDb, ctx)
      if (result.degradedToSkips.length > 0) {
        // Merge degradations: dangling-ref repair (SET NULL / prune) and/or soft-ref
        // disclosures (e.g. message attachment blob not staged). Logged for diagnostics;
        // cross-restart UI disclosure is a follow-up (B3).
        logger.info('merge completed with disclosed degradations', {
          degradations: result.degradedToSkips.map((s) => `${s.table} (${s.count}): ${s.reason}`)
        })
      }
      this.assertNotCancelled(options)

      // (d) Migrate work forward to the bundled latest, then read its COMPLETE applied chain.
      // applyMigrations is a no-op when work (a copy of live) is already current.
      this.emit(options, 'migrate', 0, 1, 'applying migrations to work.sqlite')
      applyMigrations(workDb, this.deps.migrationsFolder)
      const chain = readAppliedChain(workSqlite)
      // (d) Producer-side exact-equality seal (plan (d) M5): the work chain MUST equal the
      // bundled chain item-by-item. An ahead-of-code or forked work DB is aborted here rather
      // than relaunched for the gate to expire. The gate keeps the weaker prefix check to
      // tolerate binary changes between staging and relaunch.
      this.verifyChainExactEquality(chain)

      // (c) Seal work: fold any WAL into main, close ALL connections, assert no sidecars.
      this.emit(options, 'seal', 0, 1, 'sealing work.sqlite')
      this.sealWork(workSqlite)
      workSqlite.close()
      workSqlite = undefined
      this.assertSealed(workPath)
      this.assertNotCancelled(options)

      // (c) Second fingerprint — the LAST async check before the journal write. Re-capture live
      // (checkpointTruncate + hash) and compare. A checkpoint fold is required so a writer whose
      // data still sits in the WAL (main file unchanged) is still detected. A mismatch means a
      // writer touched live during staging → abort WITHOUT writing the journal (fail-closed).
      // The gate re-checks anyway; this early abort avoids wasting a relaunch.
      this.emit(options, 'verify', 0, 1, 're-verifying live DB fingerprint')
      await this.verifyFingerprint(fingerprint)
      // Final cancellation check — an abort during the rehash must NOT proceed to write the
      // journal + relaunch (the 2nd fingerprint is the last async before the synchronous write).
      this.assertNotCancelled(options)

      const journal: RestoreJournal = {
        version: 1,
        restoreId: options.restoreId,
        createdAt: new Date().toISOString(),
        state: 'staged',
        db: {
          promote: path.relative(this.deps.userData, workPath),
          aside: path.relative(this.deps.userData, asideAbs),
          fingerprint,
          chain
        },
        // Additive resources only — skips are not journal fields (P1-5); B4 reads plan.skips.
        fileResources: plan.resources
      }
      // writeRestoreJournal renames the journal before its parent-dir fsync; a throw after the
      // rename still leaves a valid staged journal on disk (plan R1-M3). Reread: if it landed
      // for this restore, treat as committed (preserve staging); else propagate.
      this.emit(options, 'journal', 0, 1, 'writing staged restore journal')
      try {
        writeRestoreJournal(journal)
      } catch (writeErr) {
        const reread = readRestoreJournal()
        if (
          reread.kind === 'ok' &&
          reread.journal.restoreId === options.restoreId &&
          reread.journal.state === 'staged'
        ) {
          logger.warn(
            'writeRestoreJournal threw after rename — journal landed, treating as committed',
            writeErr as Error
          )
        } else {
          throw writeErr
        }
      }
      committed = true

      return {
        restoreId: options.restoreId,
        journalPath: this.deps.journalPath,
        plan: { skips: plan.skips, toRestore: plan.toRestore, resources: plan.resources }
      }
    } finally {
      // Fail-closed cleanup: if the journal was NOT committed, tear down this restore's
      // staging subtree so no half-built work.sqlite lingers. The startup GC (plan (h))
      // is the backstop if this cleanup itself throws or the process dies mid-pipeline.
      if (!committed) {
        if (workSqlite) {
          try {
            workSqlite.close()
          } catch {
            // best-effort — the file may be deleted below anyway
          }
        }
        await this.cleanupStaging(workDir)
      }
    }
  }

  /** Fold WAL into main on the work connection (no-op under DELETE journal mode; belt-and-suspenders). */
  private sealWork(workSqlite: Database.Database): void {
    checkpointTruncateAssert(workSqlite)
  }

  /** Assert work.sqlite carries no -wal/-shm sidecars (the gate renames only the main file). */
  private assertSealed(workPath: string): void {
    if (fs.existsSync(`${workPath}-wal`) || fs.existsSync(`${workPath}-shm`)) {
      throw new Error(`importBackup: work.sqlite seal failed — sidecar remains (${workPath}-wal/-shm)`)
    }
  }

  /** Re-capture the live fingerprint (checkpointTruncate + hash) and compare to the pre-snapshot value. */
  private async verifyFingerprint(captured: string): Promise<void> {
    const recomputed = await captureLiveFingerprint(this.deps.dbService, this.deps.liveDbPath)
    if (recomputed !== captured) {
      throw new RestoreFingerprintMismatchError(captured, recomputed)
    }
  }

  /**
   * Producer-side exact-equality seal (plan (d) M5): the work DB's COMPLETE applied chain must
   * equal the bundled chain item-by-item (same length, same folderMillis+hash at each index).
   * An ahead-of-code or forked work DB is aborted here rather than relaunched for the gate to
   * expire. The gate keeps the weaker prefix check to tolerate binary changes between staging
   * and relaunch.
   */
  private verifyChainExactEquality(workChain: readonly AppliedMigration[]): void {
    // An empty chain would pass the length+item comparison trivially but the journal schema
    // requires chain.min(1) — an unmigrated DB must not be journaled (it'd be quarantined post-relaunch).
    if (workChain.length === 0) {
      throw new Error(
        'importBackup: work chain is empty — an unmigrated DB cannot be journaled (RestoreJournalSchema requires chain.min(1))'
      )
    }
    const bundled = readMigrationFiles({ migrationsFolder: this.deps.migrationsFolder })
    if (workChain.length !== bundled.length) {
      throw new Error(
        `importBackup: work chain length ${workChain.length} !== bundled ${bundled.length} (ahead-of-code or fork — aborting)`
      )
    }
    for (let i = 0; i < workChain.length; i++) {
      if (workChain[i].folderMillis !== bundled[i].folderMillis || workChain[i].hash !== bundled[i].hash) {
        throw new Error(
          `importBackup: work chain diverges from bundled at index ${i} (folderMillis ${workChain[i].folderMillis} vs ${bundled[i].folderMillis}) — fork, aborting`
        )
      }
    }
  }

  private assertNotCancelled(options: ImportBackupOptions): void {
    if (options.signal?.aborted) throw new BackupCancelledError()
  }

  private emit(
    options: ImportBackupOptions,
    phase: ImportPhase,
    current: number,
    total: number,
    message?: string
  ): void {
    options.onProgress?.({ phase, current, total, message })
  }

  /** Best-effort recursive removal of a staging subtree (tolerates a missing dir). */
  private async cleanupStaging(workDir: string): Promise<void> {
    try {
      await fs.promises.rm(workDir, { recursive: true, force: true })
    } catch (e) {
      // best-effort — startup GC (plan (h)) is the backstop for residue on the next boot
      logger.warn('staging cleanup failed (startup GC will catch residue)', e as Error)
    }
  }
}
