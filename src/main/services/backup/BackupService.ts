// BackupService — WhenReady lifecycle owner of the backup export pipeline.
//
// WHY THIS IS A LIFECYCLE SERVICE (not a lazy named export):
// Wiring BackupService into the lifecycle container is what makes the contributor
// registry's 26-invariant finalize run at APPLICATION STARTUP. onInit() calls
// contributorManager.getRegistry() (lazy finalize); a bad registry throws
// ContributorFinalizeError → onInit fails → @ErrorHandling('fail-fast') aborts
// bootstrap. That is the validation contract documented on ContributorManager
// ("the lifecycle container refuses to start"). A non-lifecycle holder would let
// export run without ever triggering finalize, so a broken registry would ship
// silently — exactly what fail-fast startup validation exists to prevent.
//
// The WhenReady phase ALSO guarantees DbService (BeforeReady) + initPathRegistry
// have completed before onInit — so the live DB file exists with migrations
// applied and the wired application paths resolve. Export can therefore never
// snapshot a pre-migration DB.
//
// SLICE SCOPE: export (FULL + LITE presets, DB + file-blob archive) + restore staging
// spine. The renderer triggers export via backup.start_backup; restore runs the
// ImportOrchestrator spine (quiesce → fingerprint → snapshot → merge → migrate → seal →
// stage → 2nd fingerprint → journal → relaunch) but is FAIL-CLOSED until write-quiesce
// lands — quiesce throws, so no staged journal is written without it. MergeEngine
// (SKIP/INSERT + junction + FTS) is wired; file-resource staging stays fail-closed.
// performRestoreRecovery at startup GCs staging residue from a crashed prior restore.

import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { lstat, readdir, stat, statfs } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Emitter, ErrorHandling, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { isPathInside } from '@main/utils/legacyFile'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { BackupProgressUpdate, BackupV2StartResult } from '@shared/types/backup'
import { and, eq, isNull, sum } from 'drizzle-orm'
import { app } from 'electron'

import { admitArchive } from './admitArchive'
import { contributorManager } from './contributors'
import {
  BackupArchiveCorruptError,
  BackupCancelledError,
  BackupIntegrityError,
  DiskFullError,
  InsufficientDiskSpaceError,
  NewerOrDivergedBackupError,
  OutputPathExistsError,
  RestoreMergeNotImplementedError,
  RestoreQuiesceNotImplementedError,
  RestoreStagingNotImplementedError,
  UnsupportedBackupFormatError
} from './errors'
import { SqliteBackupStripper } from './ExcludedDomainStripper'
import { ExportOrchestrator } from './ExportOrchestrator'
import { ImportOrchestrator } from './ImportOrchestrator'
import { MergeEngine } from './merge'

const logger = loggerService.withContext('BackupService')

/**
 * Boot-once guard for staging-residue GC. `onInit` can re-run on a service restart
 * (stop→start on the same instance), and `onStop` only signals abort without awaiting
 * an in-flight restore — so a restart could otherwise re-run `gcStagingResidue` and
 * delete an active restore's tree. Residue GC only makes sense once per process boot.
 */
let stagingResidueGcDone = false

/** Renderer-facing export request (renderer passes preset + path; service fills the rest). */
export interface BackupV2StartOptions {
  /** 'full' = all 14 domains + blobs; 'lite' = 10 domains (excludes KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY), no blobs. */
  readonly preset: 'full' | 'lite'
  readonly outputPath: string
}

/** Renderer-facing restore request (the .cbu path comes from an open dialog). */
export interface BackupRestoreStartOptions {
  readonly archivePath: string
}

/** Restore start result — restoreId is the cancel/progress routing key. */
export interface BackupRestoreResult {
  readonly restoreId: string
}

/**
 * In-flight operation state. One active operation at a time — export and restore are
 * mutually exclusive (a second startBackup/startRestore while one is running throws
 * 'busy'); cancel aborts the AbortController, which the orchestrator checks at each
 * step boundary (BackupCancelledError). `kind` lets cancel/progress route by type.
 */
interface ActiveOperation {
  readonly kind: 'export' | 'restore'
  readonly id: string
  readonly abortController: AbortController
}

@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
@ErrorHandling('fail-fast')
export class BackupService extends BaseService {
  private orchestrator?: ExportOrchestrator
  /** Cached last migration `when` (folderMillis) — the schema-version fingerprint. */
  private schemaMigrationId?: string
  /** Progress event bus — re-created in onInit each (re)start so stop→start gets a fresh emitter. */
  private _onProgress?: Emitter<BackupProgressUpdate>
  /** The single active operation — export OR restore, mutually exclusive (null when idle). */
  private activeOperation: ActiveOperation | null = null
  /** Finalized contributor registry, available only in the current backup surface. */
  private registry?: ReturnType<typeof contributorManager.getRegistry>
  /**
   * Notes root resolved ONCE per export (startBackup, before preflight) and reused by
   * both preflightDisk (sizing) and the ExportOrchestrator notesRoot callback (staging),
   * so a mid-export change to feature.notes.path can't make the disk budget cover a
   * different tree than staging reads (TOCTOU). Export-only; reset to undefined in
   * startBackup's finally. Safe under activeOperation mutual exclusion (one export at a
   * time, so no concurrent export can clobber it between resolve and stage).
   */
  private pendingNotesRoot: string | undefined

  protected onInit(): void {
    // Bridge progress emitter → renderer broadcast (WindowManager.broadcastToType).
    // Other main-side services may also subscribe to this._onProgress.event.
    // Re-create the emitter each (re)start: BaseService disposes it in its stop
    // finally, so re-registering the same disposed instance on restart would make
    // fire() a no-op and silently drop all progress events.
    const progress = new Emitter<BackupProgressUpdate>()
    this._onProgress = progress
    this.registerDisposable(progress)
    this.registerDisposable(
      progress.event((update) => {
        // broadcast (not send-to-window) — the export can be triggered from any window
        // hosting the backup UI (dev Settings route today; main / dedicated later), and
        // every hosting window subscribes via useIpcOn('backup.progress').
        application.get('IpcApiService').broadcast('backup.progress', update)
      })
    )
    // Restore recovery — production-usable cleanup of a crashed prior restore's
    // staging residue (must not brick the install with stale staging).
    this.performRestoreRecovery()

    // Lazily run the 26-invariant contributor finalize at startup (dev + packaged).
    // A violation throws ContributorFinalizeError → onInit fails → fail-fast aborts
    // bootstrap (the startup-validation contract; see ContributorManager docstring).
    this.registry = contributorManager.getRegistry()
    const registry = this.registry

    // Read the schema-version fingerprint once (migration journal's last `when`).
    this.schemaMigrationId = this.readSchemaMigrationId()

    // Construct the export pipeline. WhenReady runs AFTER BeforeReady
    // (DbService migrations + initPathRegistry), so the live DB exists + paths
    // resolve — the copier can never snapshot a pre-migration DB. The orchestrator
    // opens its own read-only snapshot handle on backup.sqlite so collect + stage
    // agree with the archived DB; the filesystem roots back the blob stager.
    this.orchestrator = new ExportOrchestrator({
      dbService: application.get('DbService'),
      registry,
      tempDir: application.getPath('feature.backup.temp'),
      knowledgeRoot: application.getPath('feature.knowledgebase.data'),
      skillsRoot: application.getPath('feature.agents.skills'),
      // Notes markdown bodies (PREFERENCES file resource) — full preset only.
      // Notes root is preference-driven (feature.notes.path may sit outside the
      // managed data dir). startBackup resolves it ONCE per export into
      // pendingNotesRoot; this callback returns that cached root so preflight sizing
      // and staging share the SAME tree (TOCTOU guard — see pendingNotesRoot).
      notesRoot: () => this.pendingNotesRoot,
      stripper: new SqliteBackupStripper()
    })
  }

  /**
   * Abort the active export whose id matches backupId. No-op if the id mismatches or no
   * export is running. Public so the IpcApi handler (src/main/ipc/handlers/backup.ts)
   * delegates here; the orchestrator checks the AbortSignal at the next step boundary.
   */
  cancel(backupId: string): { cancelled: boolean } {
    if (this.activeOperation?.id === backupId) {
      this.activeOperation.abortController.abort()
      return { cancelled: true }
    }
    return { cancelled: false }
  }

  /**
   * Export a .cbu archive (renderer-facing). Returns { backupId, archivePath } —
   * backupId is the cancel/progress routing key. Throws BackupCancelledError if the
   * user cancels via backup.cancel; the orchestrator's finally block still
   * cleans up temp + staging. A second startBackup while one is running throws 'busy'.
   */
  async startBackup({ preset, outputPath }: BackupV2StartOptions): Promise<BackupV2StartResult> {
    if (!this.orchestrator || !this.schemaMigrationId) {
      // Unreachable in normal boot (onInit sets both); reached only if onInit threw +
      // error handling were changed away from fail-fast. Guard anyway.
      throw new Error('BackupService: not initialized (onInit did not complete)')
    }
    if (this.activeOperation) {
      throw new Error('BackupService: an operation is already running (cancel it first)')
    }
    // Refuse unsafe output paths BEFORE any work: renderer must not overwrite the live
    // DB or other app-managed data, and must not clobber an existing file (no-clobber).
    this.validateOutputPath(outputPath)
    // Reserve the active slot BEFORE the preflight await so a concurrent startBackup
    // sees it as busy — two invokes that both pass the null check would otherwise
    // both suspend in preflight, then both start (the second overwriting activeOperation
    // and leaving the first uncancellable). Cleared in finally on any outcome.
    const backupId = randomUUID()
    const abortController = new AbortController()
    const active: ActiveOperation = { kind: 'export', id: backupId, abortController }
    this.beginActiveOperation(active)
    try {
      // Resolve the Notes root ONCE per export — preflight sizing and the orchestrator's
      // notesRoot callback both read pendingNotesRoot, so a mid-export change to
      // feature.notes.path can't make the budget cover a different tree than staging
      // reads (TOCTOU). May throw (unreadable custom path) → fails the export here.
      this.pendingNotesRoot = this.resolveNotesRoot()
      // Emit the FIRST progress event BEFORE preflight so the renderer has backupId
      // (the cancel/progress routing key) while the disk-space scan runs. Without it,
      // cancel() is a no-op until ExportOrchestrator's first 'collect' tick — leaving a
      // large knowledge/notes traversal uncancellable (the signal is still checked in
      // sumDirBytes, but the renderer needs backupId to reach it via cancel(backupId)).
      this._onProgress?.fire({
        backupId,
        phase: 'preflight',
        current: 0,
        total: 0,
        message: 'Checking disk space'
      })
      // Preflight BEFORE any copy/archive work — disk-full surfaces as a clear error
      // here rather than a mid-export SQLITE_FULL (disk budget).
      await this.preflightDisk(preset, outputPath, abortController.signal)
      const result = await this.orchestrator.exportBackup({
        preset,
        outputPath,
        restoreId: backupId,
        producerAppVersion: app.getVersion(),
        schemaMigrationId: this.schemaMigrationId,
        signal: abortController.signal,
        onProgress: (u) => {
          this._onProgress?.fire({ ...u, backupId })
        }
      })
      return { backupId, archivePath: result.archivePath }
    } catch (e) {
      // Map domain errors to stable IpcError codes so the renderer can branch on
      // e.code (cancel / disk-full) instead of regex on a message. IpcApi passes
      // IpcError instances through unchanged (IpcError.from returns the instance).
      throw this.toIpcError(e)
    } finally {
      this.endActiveOperation(active)
      // Drop the per-export resolved Notes root — the next export re-resolves fresh.
      this.pendingNotesRoot = undefined
    }
  }

  /**
   * Restore from a .cbu archive (renderer-facing). Runs the ImportOrchestrator spine:
   * quiesce → snapshot → merge → migrate → seal → 2nd fingerprint → staged journal,
   * then relaunches so the preboot promotion gate (#16884) swaps work.sqlite in.
   *
   * Fail-closed until write-quiesce lands: the orchestrator's quiesce dep throws, so
   * NO staged journal is written and NO relaunch occurs. MergeEngine is wired
   * (SKIP/INSERT + junction + FTS); file-resource staging stays fail-closed.
   * Mutually exclusive with export (activeOperation).
   */
  async startRestore({ archivePath }: BackupRestoreStartOptions): Promise<BackupRestoreResult> {
    // Reserve the active slot BEFORE any work (incl. the journal read) so the null-check and
    // the reservation are atomic — no await between them (mirrors startBackup; without this,
    // two concurrent startRestore calls could both pass the null check before either reserves).
    if (this.activeOperation) {
      throw new Error('BackupService: an operation is already running (cancel it first)')
    }
    const restoreId = `rst-${randomUUID()}`
    const abortController = new AbortController()
    const active: ActiveOperation = { kind: 'restore', id: restoreId, abortController }
    this.activeOperation = active
    try {
      // Never silently overwrite a prior restore's journal — #16884 has one fixed journal
      // file, and writeRestoreJournal overwrites. Any present journal (pending or terminal)
      // must be reported/cleared first; this guard is the backstop behind the preboot gate.
      const journal = readRestoreJournal()
      if (journal.kind === 'ok') {
        throw new IpcError(
          'BACKUP_RESTORE_PENDING',
          `backup: a prior restore is in state '${journal.journal.state}' — report or clear it before starting another`
        )
      }
      if (journal.kind === 'corrupt') {
        throw new IpcError('BACKUP_RESTORE_JOURNAL_CORRUPT', 'backup: restore journal is corrupt — see logs')
      }
      const importOrch = new ImportOrchestrator({
        dbService: application.get('DbService'),
        migrationsFolder: application.getPath('app.database.migrations'),
        liveDbPath: application.getPath('app.database.file'),
        restoreStagingRoot: application.getPath('feature.backup.restore.staging'),
        userData: application.getPath('app.userdata'),
        journalPath: application.getPath('feature.backup.restore.file'),
        // Archive admission (admitArchive.ts §9 step 0) + merge (MergeEngine — SKIP/INSERT +
        // junction + FTS) are wired. quiesce + file-resource staging stay fail-closed stubs —
        // restore is still unavailable until they land. quiesce throws before merge runs, so
        // no product archive reaches the engine; staging returns [] (nothing to promote).
        admitArchive,
        quiesceWriters: async () => {
          throw new RestoreQuiesceNotImplementedError()
        },
        mergeBackupIntoWork: (workSqlite, workDb, ctx) => {
          // Defensive belt: registry must be finalized in onInit. Unreachable in normal
          // flow (quiesce above throws first), but constructing a half-initialized engine
          // would silently merge with an empty registry.
          if (!this.registry) {
            throw new RestoreMergeNotImplementedError('contributor registry not finalized')
          }
          return new MergeEngine(this.registry).mergeBackupIntoWork(workSqlite, workDb, ctx)
        },
        stageFileResources: async () => {
          throw new RestoreStagingNotImplementedError()
        }
      })
      await importOrch.importBackup({
        archivePath,
        restoreId,
        signal: abortController.signal
        // onProgress wiring to the renderer lands with the restore progress UI.
      })
      // Staged journal written → relaunch so the preboot gate promotes it. application.relaunch
      // calls app.exit(0), which exits immediately and SKIPS the finally below + onStop — so
      // clear activeOperation first (and, when quiesce/pause holds land, release them here too)
      // so no in-flight state outlives the exit. The journal is already durable (committed
      // above), so skipping onStop is intentional: the preboot gate owns the next state.
      this.activeOperation = null
      this.triggerRelaunch()
      return { restoreId }
    } catch (e) {
      throw this.toIpcError(e)
    } finally {
      if (this.activeOperation === active) this.activeOperation = null
    }
  }

  /**
   * Relaunch the app so the preboot restore gate runs. Dev mode shows a dialog + exits
   * (no auto-restart); packaged re-execs + exits. The staged journal is picked up on
   * the next boot. (application.relaunch, not raw app.relaunch — the latter doesn't
   * exit the current process, so the gate would never run.)
   */
  private triggerRelaunch(): void {
    application.relaunch()
  }

  /**
   * Post-crash restore recovery at startup. Two concerns:
   *  - staging residue: a restore that crashed mid-staging (before writing the journal)
   *    leaves a half-built work.sqlite + staging tree with no journal to direct cleanup.
   *    With no pending/terminal journal, GC the whole staging root.
   *  - terminal/corrupt journal: kept for post-boot reporting; cleanup lands later.
   */
  private performRestoreRecovery(): void {
    const journal = readRestoreJournal()
    if (journal.kind === 'none') {
      this.gcStagingResidue()
      return
    }
    // staged/promoting: the preboot gate (runs before services start) should have
    // consumed these; reaching BackupService.onInit with one is unexpected — leave it
    // for the gate on the next boot and warn. terminal/corrupt: reported above, cleanup TBD.
    if (journal.kind === 'ok') {
      logger.warn(`restore journal present at BackupService init: state=${journal.journal.state}`)
    } else if (journal.kind === 'corrupt') {
      logger.warn('corrupt restore journal present at BackupService init (gate will quarantine)')
    }
  }

  /**
   * GC the restore staging root when no journal directs its cleanup. Only safe at
   * startup, before any new restore is accepted. A non-empty staging tree with a
   * 'none' journal means a prior restore crashed before writing the journal — its
   * half-built work.sqlite + staged files are unrecoverable garbage.
   *
   * INVARIANT: boot-once (`stagingResidueGcDone`) + refused while `activeOperation` exists.
   */
  private gcStagingResidue(): void {
    if (stagingResidueGcDone) return
    if (this.activeOperation) return
    stagingResidueGcDone = true
    const stagingRoot = application.getPath('feature.backup.restore.staging')
    if (!existsSync(stagingRoot)) return
    let entries: string[]
    try {
      entries = readdirSync(stagingRoot)
    } catch (e) {
      logger.warn('restore staging root unreadable during residue GC', e as Error)
      return
    }
    if (entries.length === 0) return
    logger.info(`GC restore staging residue: ${entries.length} orphaned subtree(s)`)
    try {
      rmSync(stagingRoot, { recursive: true, force: true })
    } catch (e) {
      logger.warn('restore staging residue GC failed', e as Error)
    }
  }

  /**
   * Verify enough free space for the export. The 1.2× safety factor matches the
   * disk budget.
   *
   * Budget per preset:
   * - DB online copy + DB embedded in archive = 2× live DB (both presets).
   * - full: internal blobs staged to files/ AND embedded in the .cbu while
   *   assembleArchive runs (temp + archive co-exist briefly) = 2× internal blob total.
   *   Full ALSO stages knowledge/ + notes/ source trees (each ~2× under the same
   *   temp + archive co-existence rule) — sized as the whole source dir, a
   *   conservative superset of what collect will actually stage.
   * - lite: omits files/ entirely (presetIncludesFiles=false), so no blob budget —
   *   charging lite for blobs would defeat its "skip large files" purpose.
   *
   * External blobs are also staged under files/ for full, but `file_entry.size` is
   * NULL for external rows (schema enforces), so a cheap SUM is unavailable — counting
   * them needs per-file fs.stat after collectFileResources resolves the ids (later in
   * the pipeline than this preflight). Accepted as a known gap: preflight is a
   * best-effort early check; a mid-export disk-full is caught at the archive write
   * stream (DiskFullError + temp cleanup, see archive.ts).
   */
  private async preflightDisk(preset: 'full' | 'lite', outputPath: string, signal?: AbortSignal): Promise<void> {
    const liveDbPath = application.getPath('app.database.file')
    const liveDbSize = (await stat(liveDbPath)).size
    let needed = liveDbSize * 2
    if (preset === 'full') {
      const internalBlobBytes = await this.sumInternalBlobBytes()
      needed += internalBlobBytes * 2
      // Knowledge base dirs (knowledge/) + Notes markdown (notes/) are staged to temp
      // AND packed into the archive for full — same ~2× as blobs. Sized as the WHOLE
      // source tree (conservative superset: staging copies only the collected baseIds /
      // PREFERENCES-referenced markdown, which isn't known until collectFileResources —
      // same late-pipeline gap as external blobs). notesRoot is undefined when no Notes
      // dir is configured (fresh install) → 0 bytes.
      const knowledgeBytes = await this.sumDirBytes(application.getPath('feature.knowledgebase.data'), signal)
      const notesRoot = this.pendingNotesRoot
      const notesBytes = notesRoot ? await this.sumDirBytes(notesRoot, signal) : 0
      // Skill dirs (full preset stages zip/local skill content via stageSkillDirs).
      // Sized as the WHOLE skills tree — a conservative superset (staging copies only
      // the collected zip/local folders, which aren't known until collect; same
      // late-pipeline gap as knowledge/notes/external blobs).
      const skillBytes = await this.sumDirBytes(application.getPath('feature.agents.skills'), signal)
      needed += (knowledgeBytes + notesBytes + skillBytes) * 2
    }
    // Staging volume (backup.sqlite + staged files) and the output archive volume
    // can differ — e.g. user backs up to an external USB / network drive while
    // temp lives on the system disk. Preflight MUST cover both, otherwise the
    // disk-full scenario it exists to prevent slips back to a mid-archive
    // DiskFullError. The archive is compressed, so reusing the uncompressed
    // `needed` is a conservative upper bound for the output volume.
    await this.assertDiskSpace(application.getPath('feature.backup.temp'), needed)
    await this.assertDiskSpace(dirname(outputPath), needed)
  }

  /**
   * Throw InsufficientDiskSpaceError when `dir`'s volume has < needed * 1.2 free.
   * Walks up from `dir` to the nearest existing ancestor before `statfs` — the
   * output parent may not exist yet (export creates it), and we must NOT mkdir
   * just to probe free space.
   */
  private async assertDiskSpace(dir: string, needed: number): Promise<void> {
    let probe = dir
    while (!existsSync(probe)) {
      const parent = dirname(probe)
      if (parent === probe) {
        throw new Error(`backup: no existing ancestor for disk-space check: ${dir}`)
      }
      probe = parent
    }
    const fsStats = await statfs(probe)
    const available = fsStats.bavail * fsStats.bsize
    if (available < needed * 1.2) {
      throw new InsufficientDiskSpaceError({ needed: Math.round(needed * 1.2), available })
    }
  }

  /**
   * Sum the `size` column over live (non-soft-deleted) internal file_entry rows.
   * Returns 0 when there are no matching rows. SQLite SUM over INTEGER returns a
   * decimal string via drizzle; coerce with Number().
   */
  private async sumInternalBlobBytes(): Promise<number> {
    // WhenReady runs after DbService (BeforeReady), so getDb() is safe to call here.
    const db = application.get('DbService').getDb()
    const rows = await db
      .select({ total: sum(fileEntryTable.size) })
      .from(fileEntryTable)
      .where(and(eq(fileEntryTable.origin, 'internal'), isNull(fileEntryTable.deletedAt)))
    return Number(rows[0]?.total ?? 0)
  }

  /**
   * Recursively sum `stat().size` over every regular file under `dir`. Sizes the
   * knowledge + notes source trees for full-preset preflight. A genuinely absent dir
   * (ENOENT/ENOTDIR — fresh install, no KB/notes yet) returns 0; any other error
   * (EACCES/EIO) rethrows so the export fails here rather than silently passing
   * preflight and failing mid-copy. UPPER BOUND: it sizes every file under the root,
   * including files staging won't collect, which suits preflight's conservative 1.2×
   * budget (and under-counts dir/sparse block overhead the margin absorbs). Sequential
   * recursion — no shared mutable counter (race-free) and no concurrent-stat fd pressure
   * on large KB trees.
   */
  private async sumDirBytes(dir: string, signal?: AbortSignal): Promise<number> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return 0
      throw e
    }
    let total = 0
    for (const name of entries) {
      // Honor cancel mid-traversal: a large knowledge/notes tree can otherwise keep
      // the user in an uncancellable preflight. The signal is live from startBackup's
      // activeOperation.abortController; combined with the 'preflight' progress event
      // (fired before this scan), the renderer's cancel() reaches this check.
      if (signal?.aborted) throw new BackupCancelledError()
      const child = join(dir, name)
      // lstat, NOT stat: stat follows symlinks/junctions, which can walk outside the
      // source tree (the Notes collector refuses just such escapes), fail on a broken
      // link, or loop forever through an ancestor link. Size only real entries — a
      // symlink contributes 0 bytes (its target is either outside scope or counted at
      // its own real location), matching stageNotes' realpath containment guard.
      let s
      try {
        s = await lstat(child)
      } catch (e) {
        // Child vanished between readdir and lstat (a normal fs race — an entry the
        // exporter is about to stage, or a concurrent prune). A definitively-absent
        // child is skippable like any other missing resource (stageFiles treats a
        // missing source as missing, not fatal); only a real read error (EACCES/EIO)
        // aborts, consistent with the readdir catch above.
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e
        continue
      }
      if (s.isSymbolicLink()) continue
      total += s.isDirectory() ? await this.sumDirBytes(child, signal) : s.size
    }
    return total
  }

  /** Read the last migration's `when` (folderMillis) from the drizzle migration journal. */
  private readSchemaMigrationId(): string {
    const migrationsDir = application.getPath('app.database.migrations')
    const journalPath = join(migrationsDir, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { when: number }[] }
    const last = journal.entries.at(-1)
    if (!last) {
      throw new Error('backup: migration journal has no entries (cannot derive schemaMigrationId)')
    }
    return String(last.when)
  }

  /**
   * Resolve the effective Notes markdown root for backup. The user-visible Notes
   * dir is `feature.notes.path` when set, else the managed default
   * (`feature.notes.data`). Returns `undefined` when the managed default is not
   * present yet (fresh install / Notes never opened) — collect then skips notes.
   * A set-but-unavailable custom path throws: falling back to the managed default
   * would produce a successful archive whose `note` overlay rows still point at
   * the custom `rootPath` while bodies came from the wrong tree. Called per export
   * so a mid-session preference change takes effect on the next backup.
   */
  private resolveNotesRoot(): string | undefined {
    const defaultRoot = application.getPath('feature.notes.data')
    const prefRaw = application.get('PreferenceService').get('feature.notes.path')
    const pref = typeof prefRaw === 'string' ? prefRaw.trim() : ''

    const requireReadableDir = (candidate: string, label: string): string => {
      try {
        if (!statSync(candidate).isDirectory()) {
          throw new Error(`${label} is not a directory: ${candidate}`)
        }
        readdirSync(candidate)
        return candidate
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        const detail = e instanceof Error ? e.message : String(e)
        throw new Error(`${label} unavailable (${code ?? 'unknown'}): ${candidate} — ${detail}`)
      }
    }

    // No custom dir configured → managed default when it exists; else undefined
    // ("no notes configured" — collect skips). Do not throw on a missing default.
    if (!pref) {
      try {
        if (statSync(defaultRoot).isDirectory()) {
          readdirSync(defaultRoot)
          return defaultRoot
        }
      } catch (e) {
        // ENOENT/ENOTDIR = managed default genuinely absent (fresh install / Notes
        // never opened) → no notes to back up (collect skips). A different code
        // (EACCES/EIO/...) means the default EXISTS but is unreadable — MUST abort
        // rather than silently omit the user's notes from a "complete" archive
        // (codex review; mirrors FileStager.isMissingPath).
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e
      }
      return undefined
    }

    const candidate = resolve(pref)
    if (candidate === defaultRoot) {
      // Preference explicitly points at the managed path — same readability rule
      // as a custom path (user opted into that location).
      return requireReadableDir(candidate, 'Notes root')
    }
    // Custom path is set: require a readable directory. Do NOT fall back to the
    // managed default — that would silently omit the user's real notes while
    // still exporting note overlay rows keyed to the custom rootPath.
    return requireReadableDir(candidate, 'custom Notes root')
  }

  /**
   * Refuse unsafe output paths. The renderer passes an arbitrary outputPath; without
   * validation, archive.ts's atomic rename would let it overwrite the live DB or other
   * app-managed data, and silently clobber any existing file. Defense in depth — the
   * renderer picks a path via a save dialog, but never trust it across the IPC boundary.
   */
  private validateOutputPath(outputPath: string): void {
    // Canonicalize via realpath of the existing parent (resolves symlinks) so a symlinked
    // path cannot route the archive into an app-managed dir that lexical isPathInside
    // misses. The parent must already exist (renderer picks via save dialog); a missing
    // parent fails here rather than mid-archive.
    const parent = dirname(resolve(outputPath))
    let realParent: string
    try {
      realParent = realpathSync(parent)
    } catch (e) {
      // Parent missing (ENOENT) or unreadable/unresolvable (EACCES / ELOOP / ...) — all
      // map to a stable invalid-path code so the renderer can branch. This check runs
      // before the mapped try block, so it must produce a stable code itself.
      throw new IpcError(
        'BACKUP_OUTPUT_PATH_INVALID',
        `backup: outputPath parent directory unavailable (${(e as NodeJS.ErrnoException).code ?? 'unknown'}): ${parent}`
      )
    }
    // realpathSync succeeds on a file too — reject a non-directory parent here, otherwise
    // createWriteStream(tmpPath) fails ENOTDIR mid-export → INTERNAL. Wrap statSync so a
    // TOCTOU disappearance / permission loss between realpath and stat also maps to
    // BACKUP_OUTPUT_PATH_INVALID instead of leaking to INTERNAL.
    let parentStat: { isDirectory(): boolean }
    try {
      parentStat = statSync(realParent)
    } catch (e) {
      throw new IpcError(
        'BACKUP_OUTPUT_PATH_INVALID',
        `backup: outputPath parent inaccessible (${(e as NodeJS.ErrnoException).code ?? 'unknown'}): ${realParent}`
      )
    }
    if (!parentStat.isDirectory()) {
      throw new IpcError('BACKUP_OUTPUT_PATH_INVALID', `backup: outputPath parent is not a directory: ${realParent}`)
    }
    const canonical = join(realParent, basename(resolve(outputPath)))
    // Refuse ANY app-managed writable path — the archive must never overwrite the live
    // DB or managed data. app.userdata is the single broad root: every feature.* sub-root
    // and the live DB file live under it (pathRegistry), so listing them separately would
    // be dead code. realpath'd so a symlinked managed dir cannot dodge the check. Add a
    // narrower entry only if a future managed path escapes userData.
    const managedRoots = [application.getPath('app.userdata')]
    for (const root of managedRoots) {
      let realRoot = root
      try {
        realRoot = realpathSync(root)
      } catch {
        // managed root may not exist yet on a fresh install — lexical fallback
      }
      if (canonical === realRoot || isPathInside(canonical, realRoot)) {
        throw new IpcError('BACKUP_UNSAFE_OUTPUT_PATH', `backup: outputPath targets an app-managed path: ${outputPath}`)
      }
    }
    // No-clobber: refuse to overwrite an existing file. archive.ts publishes via link()
    // which also refuses (EEXIST), but the entry check gives an early, clear error and
    // bounds the TOCTOU window to the export duration.
    if (existsSync(canonical)) {
      throw new IpcError('BACKUP_OUTPUT_PATH_EXISTS', `backup: outputPath already exists (no-clobber): ${outputPath}`)
    }
  }

  /**
   * Map backup domain errors to stable IpcError codes before they cross the IPC
   * boundary. The transport folds non-IpcError throws to INTERNAL, losing the class;
   * promoting them here preserves a code useBackupV2 can branch on (cancel vs disk
   * vs other) instead of regex on the message string.
   */
  private toIpcError(e: unknown): unknown {
    if (e instanceof BackupCancelledError) return new IpcError('BACKUP_CANCELLED', e.message)
    if (e instanceof InsufficientDiskSpaceError) {
      return new IpcError('BACKUP_INSUFFICIENT_DISK', e.message, {
        needed: e.needed,
        available: e.available
      })
    }
    if (e instanceof DiskFullError) return new IpcError('BACKUP_DISK_FULL', e.message)
    if (e instanceof OutputPathExistsError) return new IpcError('BACKUP_OUTPUT_PATH_EXISTS', e.message)
    if (e instanceof UnsupportedBackupFormatError) {
      return new IpcError('BACKUP_UNSUPPORTED_FORMAT', e.message, { found: e.found, expected: e.expected })
    }
    if (e instanceof NewerOrDivergedBackupError) {
      return new IpcError('BACKUP_NEWER_OR_DIVERGED', e.message, { producerAppVersion: e.producerAppVersion })
    }
    if (e instanceof BackupIntegrityError) return new IpcError('BACKUP_INTEGRITY_FAILED', e.message)
    if (e instanceof BackupArchiveCorruptError) return new IpcError('BACKUP_ARCHIVE_CORRUPT', e.message)
    // File stager / SQLite copy can surface raw ENOSPC errno or SQLITE_FULL code outside
    // archive.ts (which only wraps its own writeStream ENOSPC → DiskFullError). Normalize
    // both to BACKUP_DISK_FULL so the renderer never sees INTERNAL for disk-full.
    const code = (e as NodeJS.ErrnoException | { code?: string })?.code
    if (code === 'ENOSPC' || code === 'SQLITE_FULL') {
      return new IpcError('BACKUP_DISK_FULL', e instanceof Error ? e.message : String(e))
    }
    return e // unknown throws pass through; IpcApiService folds them to INTERNAL
  }

  private beginActiveOperation(active: ActiveOperation): void {
    this.activeOperation = active
  }

  private endActiveOperation(active: ActiveOperation): void {
    if (this.activeOperation !== active) return
    this.activeOperation = null
  }

  protected onStop(): void {
    // Signal an in-flight operation to abort so shutdown is not holding the snapshot
    // copy + staging open. The orchestrator checks the abort signal at its next step
    // boundary + its finally cleans up temp + staging. (Sync stop cannot await the
    // async drain; abort is the bounded-shutdown lever.)
    this.activeOperation?.abortController.abort()
  }
}
