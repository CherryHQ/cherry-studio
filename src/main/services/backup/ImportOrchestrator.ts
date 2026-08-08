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
// fileResources and the disclosure summary come from the same plan and are
// persisted together so a renderer reload cannot lose or invent the summary.

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { applyMigrations } from '@main/data/db/applyMigrations'
import type { ExportResourceDegradation } from '@main/data/db/backup/contributorTypes'
import type { DbService } from '@main/data/db/DbService'
import { type AppliedMigration, readAppliedChain } from '@main/data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { readRestoreJournal, type RestoreJournal, writeRestoreJournal } from '@main/data/db/restore/restoreJournal'
import type { DbType } from '@main/data/db/types'
import type { MergeContext, MergeResult, ReconcileDegradationKind } from '@main/services/reconciliation'
import type { RestoreDegradation, RestoreResultSummary } from '@shared/types/backup'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { ArchiveContext } from './admitArchive'
import { BackupCancelledError, RestoreFingerprintMismatchError } from './errors'
import { captureLiveFingerprint } from './fingerprintProducer'
import { scanMissingMcpPackageDirs } from './missingLocalResourceScan'
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
  /**
   * Immediate broadcast payload — the SAME object persisted as journal.summary, so a
   * renderer reload cannot see a summary that differs from the durable one.
   */
  readonly summary: RestoreResultSummary
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

/**
 * Engine vocabulary → backup's published contract. `RestoreDegradationKind` is the IPC +
 * renderer-i18n surface (zod-validated, 13 locale files key off it), so it must not move
 * with the engine; this table is the one place the two vocabularies meet. The
 * `Record<ReconcileDegradationKind, …>` shape makes a missing mapping a compile error if the
 * engine ever adds a kind.
 */
const RESTORE_DEGRADATION_KIND: Record<ReconcileDegradationKind, RestoreDegradation['kind']> = {
  ref_cleared: 'ref_cleared',
  row_pruned: 'row_pruned',
  rows_skipped: 'rows_skipped',
  association_dropped: 'association_dropped',
  field_conflict: 'field_conflict',
  remote_overwrote_local: 'backup_overwrote_local',
  attachment_unavailable: 'attachment_unavailable',
  resource_content_missing: 'resource_content_missing'
}

/**
 * Fold the export-side `manifest.degraded` records into the restore degradation contract.
 * These skills restore as a registered DB row whose file content the archive never carried
 * (omitted under lite, or absent on disk at export time) — the user only learns that here.
 * Aggregated per reason so the summary stays one line per cause, with the folder names in
 * `detail` (bounded: the manifest itself is capped at 1 MiB by admission).
 */
function summarizeManifestDegradations(records: readonly ExportResourceDegradation[]): RestoreDegradation[] {
  const byKind = new Map<ExportResourceDegradation['kind'], string[]>()
  for (const r of records) {
    const bucket = byKind.get(r.kind)
    if (bucket) bucket.push(r.folderName)
    else byKind.set(r.kind, [r.folderName])
  }
  return [...byKind].map(([kind, folderNames]) => ({
    kind: 'resource_content_missing' as const,
    scope: 'agent_global_skill',
    count: folderNames.length,
    detail: `${kind}: ${folderNames.join(', ')}`
  }))
}

/** RestoreId must be a safe basename — it becomes a directory under the staging root. */
function isSafeBasename(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) && !id.includes('..') && id !== '.' && id !== '..'
}

/**
 * D6: describes one discovered aside slot for retention tracking. An aside is the live-DB
 * rename target at promotion (`<liveDbPath>.aside-<restoreId>`); multiple restores across
 * boots can leave multiple asides. This slot structure makes the aside lifecycle observable
 * so a retention sweeper can be wired once the owner decides the numbers.
 */
export interface AsideRetentionSlot {
  readonly restoreId: string
  readonly asidePath: string
  /** mtime of the aside file (creation/proxied via the filesystem). */
  readonly createdAtMs: number
}

/**
 * D6: aside retention policy. The values (maxSlots / maxAgeMs / consecutive) AND the
 * sweeper semantics are owner-TBD (@0xfullex — §9 :411 "retention/GC numbers TBD"). This
 * skeleton declares the structure so the aside lifecycle is tracked; it does NOT invent
 * retention numbers and the sweeper does NOT delete anything until the owner decides.
 */
export interface AsideRetentionConfig {
  /** Max aside slots retained before the oldest is swept. null = undecided (owner-TBD). */
  readonly maxSlots: number | null
  /** Max age (ms) before an aside is swept. null = undecided (owner-TBD). */
  readonly maxAgeMs: number | null
}

/**
 * D6: placeholder retention config — every field is null (owner-TBD @0xfullex). The
 * discover+log skeleton uses this so the structure is real and exercised, but no aside is
 * ever deleted until the owner supplies concrete retention numbers.
 */
export const ASIDE_RETENTION_TBD: AsideRetentionConfig = { maxSlots: null, maxAgeMs: null }

/**
 * D6: discover existing aside slots in the live DB's directory. An aside is named
 * `<liveDbPath>.aside-<restoreId>`. Returns slots oldest-first by mtime. Best-effort — a
 * missing/unreadable directory yields an empty list (the sweeper is a no-op then).
 *
 * The sweeper that would retain/expire these slots is owner-TBD (retention numbers +
 * consecutive-restore semantics @0xfullex); today this only enumerates for observability.
 */
export function discoverAsideSlots(liveDbPath: string): AsideRetentionSlot[] {
  const dir = path.dirname(liveDbPath)
  const prefix = `${path.basename(liveDbPath)}.aside-`
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const slots: AsideRetentionSlot[] = []
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue
    const restoreId = name.slice(prefix.length)
    if (!restoreId) continue
    try {
      const st = fs.statSync(path.join(dir, name))
      slots.push({ restoreId, asidePath: path.join(dir, name), createdAtMs: st.mtimeMs })
    } catch {
      // vanished between readdir and stat — skip
    }
  }
  return slots.sort((a, b) => a.createdAtMs - b.createdAtMs)
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
    // D6: discover existing aside slots for retention observability. The sweeper (retain/
    // expire by maxSlots/maxAgeMs) is owner-TBD (@0xfullex) — today this only logs the
    // discovered slots so stale asides are visible; nothing is deleted here.
    const existingAsides = discoverAsideSlots(this.deps.liveDbPath)
    if (existingAsides.length > 0) {
      logger.info(`aside retention: discovered ${existingAsides.length} existing aside slot(s)`, {
        slots: existingAsides.map((s) => ({ restoreId: s.restoreId, createdAtMs: s.createdAtMs })),
        config: ASIDE_RETENTION_TBD
      })
    }

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
      // 0700 like admission's mkdir — the tree holds secrets until promotion deletes it.
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 })
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
        roots: this.deps.planRoots,
        asideRoot: application.getPath('feature.backup.restore.aside')
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
        resourcePlan: plan,
        includeFiles: presetIncludesFiles(archiveContext.manifest.preset),
        hostSystemWorkspacesRoot: application.getPath('feature.agents.system_workspaces')
      }
      const result = await this.deps.mergeBackupIntoWork(workSqlite, workDb, ctx)
      // Merge degradations (dangling-ref repair, junction / polymorphic drops, field
      // conflicts, attachment disclosure) plus the export-side content omissions the
      // manifest recorded. These describe loss the restore ALREADY accepted, so they must
      // outlive this process in the journal — the confirmation UI runs after the relaunch.
      const degradations: readonly RestoreDegradation[] = [
        ...result.degradedToSkips.map((s) => ({
          kind: RESTORE_DEGRADATION_KIND[s.kind],
          scope: s.table,
          count: s.count,
          detail: s.reason
        })),
        ...summarizeManifestDegradations(archiveContext.manifest.degraded.resources)
      ]
      if (degradations.length > 0) {
        logger.info('restore completed with disclosed degradations', {
          degradations: degradations.map((d) => `${d.scope} [${d.kind}] (${d.count}): ${d.detail ?? ''}`)
        })
      }
      this.assertNotCancelled(options)

      // D8 统计告知版 (disposition matrix D8/B10, node 2.1): scan MCP_SERVERS rows in the
      // post-merge work DB for `dxtPath` package dirs missing on the LOCAL filesystem. A
      // schema-only restore re-creates the row but not the DXT package dir → the server cannot
      // start on a new machine. NON-BLOCKING: this only logs a summary stat (count + server
      // names); it does NOT gate admission/merge and does NOT touch RestoreDegradation / journal
      // summary / result-page UI. User-visible disclosure is a contract decision owner TBD
      // (@DeJeune file-resource hooks — full staging provider lands later). Scoped to restores
      // that include the MCP_SERVERS domain so an unrelated restore stays silent.
      if (archiveContext.domains.includes('MCP_SERVERS')) {
        const missingMcp = scanMissingMcpPackageDirs(workSqlite)
        if (missingMcp.count > 0) {
          logger.warn('restore: MCP server package dirs missing on local filesystem (non-blocking)', {
            count: missingMcp.count,
            scopes: missingMcp.servers.map((s) => s.name),
            paths: missingMcp.servers.map((s) => s.dxtPath)
          })
        }
      }

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

      const summary: RestoreResultSummary = {
        toRestore: plan.toRestore,
        toSkip: plan.skips,
        degradations
      }
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
        fileResources: plan.resources,
        summary
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

      return { restoreId: options.restoreId, journalPath: this.deps.journalPath, summary }
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
