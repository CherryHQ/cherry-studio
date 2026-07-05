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
// SLICE SCOPE: export-only, FULL preset, DB-only archive. The lite preset (needs
// the FK-aware contributor strip step) + file/knowledge blob staging land with
// the contributor export hooks (see ExportOrchestrator docstring). IPC channels
// bind in a follow-up slice; until then exportBackup is exercised via tests.

import { application } from '@application'
import { BaseService, ErrorHandling, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { SqliteBackupCopier } from './BackupDbCopier'
import type { ExportBackupOptions, ExportBackupResult } from './ExportOrchestrator'
import { ExportOrchestrator } from './ExportOrchestrator'
import { contributorManager } from './contributors/ContributorManager'

@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
@ErrorHandling('fail-fast')
export class BackupService extends BaseService {
  private orchestrator?: ExportOrchestrator

  protected onInit(): void {
    // Lazily run the 26-invariant contributor finalize at startup. A violation
    // throws ContributorFinalizeError → onInit fails → fail-fast aborts bootstrap
    // (the startup-validation contract; see ContributorManager docstring).
    const registry = contributorManager.getRegistry()

    // Construct the export pipeline. WhenReady runs AFTER BeforeReady
    // (DbService migrations + initPathRegistry), so the live DB exists + paths
    // resolve — the copier can never snapshot a pre-migration DB.
    this.orchestrator = new ExportOrchestrator({
      copier: new SqliteBackupCopier(application.getPath('app.database.file')),
      registry,
      tempDir: application.getPath('feature.backup.temp')
    })
  }

  /**
   * Export a .cbu archive. Full preset only this slice — lite is gated off in the
   * orchestrator (needs the contributor strip step that lands with the export hooks).
   */
  exportBackup(options: ExportBackupOptions): Promise<ExportBackupResult> {
    if (!this.orchestrator) {
      // Unreachable in normal boot (onInit constructs it); reached only if onInit
      // threw + error handling were changed away from fail-fast. Guard anyway so a
      // misconfigured lifecycle never dereferences undefined.
      throw new Error('BackupService: orchestrator not initialized (onInit did not complete)')
    }
    return this.orchestrator.exportBackup(options)
  }
}
