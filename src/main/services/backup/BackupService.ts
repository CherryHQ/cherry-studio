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
// SLICE SCOPE: export-only, FULL preset, DB + file-blob archive. The renderer
// triggers export via the BackupV2_StartBackup IPC channel (filled defaults:
// restoreId / producerAppVersion / schemaMigrationId). preflightDisk guards the
// entry. The lite preset (FK-aware contributor strip), cancel/progress/validate
// channels, and the restore side land in follow-up slices.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { BaseService, ErrorHandling, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { app } from 'electron'

import { SqliteBackupCopier } from './BackupDbCopier'
import type { ExportBackupResult } from './ExportOrchestrator'
import { ExportOrchestrator } from './ExportOrchestrator'
import { contributorManager } from './contributors/ContributorManager'
import { InsufficientDiskSpaceError } from './errors'

/** Renderer-facing export request (renderer passes preset + path; service fills the rest). */
export interface BackupV2StartOptions {
  /** 'full' only — 'lite' is gated off in the orchestrator (needs the contributor strip). */
  readonly preset: 'full'
  readonly outputPath: string
}

@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
@ErrorHandling('fail-fast')
export class BackupService extends BaseService {
  private orchestrator?: ExportOrchestrator
  /** Cached last migration `when` (folderMillis) — the schema-version fingerprint. */
  private schemaMigrationId?: string

  protected onInit(): void {
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
      knowledgeRoot: application.getPath('feature.knowledgebase.data')
    })

    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    // TODO(ipc-boundary): migrate to IpcApi (`backup.start_backup` route with a typed
    // schema + handler) per CLAUDE.md "new non-data command IPC goes through IpcApi".
    // The legacy ipcHandle is acceptable while IpcApi + legacy coexist, but the
    // renderer payload currently reaches startBackup without schema validation —
    // wire an IpcApi route (or add main-side zod validation) in the IPC-boundary slice.
    // Export entry. Renderer passes { preset, outputPath }; the service fills
    // restoreId / producerAppVersion / schemaMigrationId + runs preflightDisk.
    this.ipcHandle(IpcChannel.BackupV2_StartBackup, async (_e, opts: BackupV2StartOptions) => {
      const result = await this.startBackup(opts)
      return { archivePath: result.archivePath, manifest: result.manifest }
    })
  }

  /**
   * Export a .cbu archive (renderer-facing). Full preset only this slice — lite
   * is gated off in the orchestrator (needs the contributor strip step).
   */
  async startBackup({ preset, outputPath }: BackupV2StartOptions): Promise<ExportBackupResult> {
    if (!this.orchestrator || !this.schemaMigrationId) {
      // Unreachable in normal boot (onInit sets both); reached only if onInit threw
      // + error handling were changed away from fail-fast. Guard anyway.
      throw new Error('BackupService: not initialized (onInit did not complete)')
    }
    // Preflight BEFORE any copy/archive work — disk-full surfaces as a clear error
    // here rather than a mid-export SQLITE_FULL (spec export-orchestrator.md §磁盘预算).
    await this.preflightDisk()
    return this.orchestrator.exportBackup({
      preset,
      outputPath,
      restoreId: randomUUID(),
      producerAppVersion: app.getVersion(),
      schemaMigrationId: this.schemaMigrationId
    })
  }

  /**
   * Verify enough free space for the export. Conservative lower bound = 2× live DB
   * (online copy + archive); the 1.2× safety factor matches spec §磁盘预算.
   */
  private async preflightDisk(): Promise<void> {
    const liveDbPath = application.getPath('app.database.file')
    const liveDbSize = (await stat(liveDbPath)).size
    // TODO: add file_entry blob size sum (internal size column) once a cheap aggregate
    // is wired — blobs can dominate the archive size for file-heavy users.
    const needed = liveDbSize * 2
    const tempDir = application.getPath('feature.backup.temp')
    const fsStats = await statfs(tempDir)
    const available = fsStats.bavail * fsStats.bsize
    if (available < needed * 1.2) {
      throw new InsufficientDiskSpaceError({ needed: Math.round(needed * 1.2), available })
    }
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
}
