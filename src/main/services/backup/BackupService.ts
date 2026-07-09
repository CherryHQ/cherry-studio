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
// SLICE SCOPE: export-only, FULL + LITE presets, DB + file-blob archive. The
// renderer triggers export via the backup.start_backup IpcApi route (filled
// defaults: restoreId / producerAppVersion / schemaMigrationId). preflightDisk
// guards the entry. Step 2.5 (SqliteBackupStripper) strips ALWAYS_STRIP + lite
// excluded rows from the copy. cancel/progress/validate channels and the restore
// side land in follow-up slices.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { stat, statfs } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Emitter, ErrorHandling, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { fileEntryTable } from '@main/data/db/schemas/file'
import type { BackupProgressUpdate, BackupV2StartResult } from '@shared/types/backup'
import { and, eq, isNull, sum } from 'drizzle-orm'
import { app } from 'electron'

import { SqliteBackupCopier } from './BackupDbCopier'
import { contributorManager } from './contributors'
import { InsufficientDiskSpaceError } from './errors'
import { SqliteBackupStripper } from './ExcludedDomainStripper'
import { ExportOrchestrator } from './ExportOrchestrator'

/** Renderer-facing export request (renderer passes preset + path; service fills the rest). */
export interface BackupV2StartOptions {
  /** 'full' = all 14 domains + blobs; 'lite' = 10 domains (excludes KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY), no blobs. */
  readonly preset: 'full' | 'lite'
  readonly outputPath: string
}

/**
 * In-flight export state. One active export at a time (a second startBackup while
 * one is running throws 'busy'); cancel aborts the AbortController, which the
 * orchestrator checks at each step boundary (BackupCancelledError).
 */
interface ActiveExport {
  readonly backupId: string
  readonly abortController: AbortController
}

@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
@ErrorHandling('fail-fast')
export class BackupService extends BaseService {
  private orchestrator?: ExportOrchestrator
  /** Cached last migration `when` (folderMillis) — the schema-version fingerprint. */
  private schemaMigrationId?: string
  /** Progress event bus — bridged to the renderer (backup.progress event) in onInit. */
  private readonly _onProgress = new Emitter<BackupProgressUpdate>()
  /** The single active export (null when idle). */
  private activeExport: ActiveExport | null = null
  /** Service logger — Notes-root fallback warnings land here so they are observable. */
  private readonly logger = loggerService.withContext('backup')

  protected onInit(): void {
    // Bridge progress emitter → renderer broadcast (WindowManager.broadcastToType).
    // Other main-side services may also subscribe to this._onProgress.event.
    this.registerDisposable(this._onProgress)
    this.registerDisposable(
      this._onProgress.event((update) => {
        // broadcast (not send-to-window) — the export can be triggered from any window
        // hosting the backup UI (dev Settings route today; main / dedicated later), and
        // every hosting window subscribes via useIpcOn('backup.progress').
        application.get('IpcApiService').broadcast('backup.progress', update)
      })
    )
    // Lazily run the 26-invariant contributor finalize at startup. A violation
    // throws ContributorFinalizeError → onInit fails → fail-fast aborts bootstrap
    // (the startup-validation contract; see ContributorManager docstring).
    const registry = contributorManager.getRegistry()

    // Read the schema-version fingerprint once (migration journal's last `when`).
    this.schemaMigrationId = this.readSchemaMigrationId()

    // Construct the export pipeline. WhenReady runs AFTER BeforeReady
    // (DbService migrations + initPathRegistry), so the live DB exists + paths
    // resolve — the copier can never snapshot a pre-migration DB. The orchestrator
    // opens its own read-only snapshot handle on backup.sqlite so collect + stage
    // agree with the archived DB; the filesystem roots back the blob stager.
    this.orchestrator = new ExportOrchestrator({
      copier: new SqliteBackupCopier(application.getPath('app.database.file')),
      registry,
      tempDir: application.getPath('feature.backup.temp'),
      filesRoot: application.getPath('feature.files.data'),
      knowledgeRoot: application.getPath('feature.knowledgebase.data'),
      // Notes markdown bodies (PREFERENCES file resource) — full preset only.
      // Notes root is preference-driven (feature.notes.path may sit outside the
      // managed data dir), so resolve it fresh per export — see resolveNotesRoot.
      notesRoot: () => this.resolveNotesRoot(),
      stripper: new SqliteBackupStripper()
    })
  }

  /**
   * Abort the active export whose id matches backupId. No-op if the id mismatches or no
   * export is running. Public so the IpcApi handler (src/main/ipc/handlers/backup.ts)
   * delegates here; the orchestrator checks the AbortSignal at the next step boundary.
   */
  cancel(backupId: string): { cancelled: boolean } {
    if (this.activeExport?.backupId === backupId) {
      this.activeExport.abortController.abort()
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
      // Unreachable in normal boot (onInit sets both); reached only if onInit threw
      // + error handling were changed away from fail-fast. Guard anyway.
      throw new Error('BackupService: not initialized (onInit did not complete)')
    }
    if (this.activeExport) {
      throw new Error('BackupService: an export is already running (cancel it first)')
    }
    // Reserve the active slot BEFORE the preflight await so a concurrent startBackup
    // sees it as busy — two invokes that both pass the null check would otherwise
    // both suspend in preflight, then both start (the second overwriting activeExport
    // and leaving the first uncancellable). Cleared in finally on any outcome.
    const backupId = randomUUID()
    const abortController = new AbortController()
    const active: ActiveExport = { backupId, abortController }
    this.activeExport = active
    try {
      // Preflight BEFORE any copy/archive work — disk-full surfaces as a clear error
      // here rather than a mid-export SQLITE_FULL (disk budget).
      await this.preflightDisk(preset, outputPath)
      const result = await this.orchestrator.exportBackup({
        preset,
        outputPath,
        restoreId: backupId,
        producerAppVersion: app.getVersion(),
        schemaMigrationId: this.schemaMigrationId,
        signal: abortController.signal,
        onProgress: (u) => {
          this._onProgress.fire({ ...u, backupId })
        }
      })
      return { backupId, archivePath: result.archivePath }
    } finally {
      if (this.activeExport === active) this.activeExport = null
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
  private async preflightDisk(preset: 'full' | 'lite', outputPath: string): Promise<void> {
    const liveDbPath = application.getPath('app.database.file')
    const liveDbSize = (await stat(liveDbPath)).size
    let needed = liveDbSize * 2
    if (preset === 'full') {
      const internalBlobBytes = await this.sumInternalBlobBytes()
      needed += internalBlobBytes * 2
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
   * Resolve the effective Notes markdown root for backup. Mirrors the renderer's
   * resolveNotesPath (NotesService.ts): the user-visible Notes dir is the
   * feature.notes.path preference when set + valid, else the managed default
   * (feature.notes.data, a static path namespace). Backup must scan the same root
   * the user sees — hard-wiring the default would silently miss the notes of anyone
   * who configured a custom dir (e.g. ~/Documents/MyNotes). Called per export so a
   * mid-session preference change takes effect on the next backup.
   */
  private resolveNotesRoot(): string {
    const defaultRoot = application.getPath('feature.notes.data')
    const prefRaw = application.get('PreferenceService').get('feature.notes.path')
    const pref = typeof prefRaw === 'string' ? prefRaw.trim() : ''
    // No custom dir configured (fresh user, or never opened Notes settings) → default.
    if (!pref) return defaultRoot
    const candidate = resolve(pref)
    if (candidate === defaultRoot) return defaultRoot
    // Validate the custom dir exists, is a directory, and is readable. An
    // inaccessible custom dir falls back to the managed default — matching the
    // renderer, which shows the default Notes tree when the configured dir is
    // unavailable. Warn so the fallback is observable rather than a silent
    // partial backup. readdirSync catches mode-000 / EACCES dirs that still
    // pass isDirectory() via stat.
    try {
      if (statSync(candidate).isDirectory()) {
        readdirSync(candidate)
        return candidate
      }
    } catch {
      // stat/readdir failed (missing / permission) — fall through to default + warn.
    }
    this.logger.warn('custom Notes root unavailable, backing up the managed default', {
      candidate,
      defaultRoot
    })
    return defaultRoot
  }
}
