import fs from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'
import { clearTerminalRestoreArtifacts } from '@main/data/db/restore/clearTerminalRestoreArtifacts'
import { readRestoreJournal, type RestoreJournal } from '@main/data/db/restore/restoreJournal'
import { fileStorage } from '@main/services/FileStorage'
import { devResetError, DevResetErrorCode } from '@shared/ipc/schemas/dev'
import { app } from 'electron'

const logger = loggerService.withContext('DevResetCoordinator')

const JOB_DRAIN_TIMEOUT_MS = 30_000
/** If relaunch does not exit the process, force-exit so we never report success then sit dead. */
const RELAUNCH_WATCHDOG_MS = 5_000

type TerminalJournal = Extract<RestoreJournal, { state: 'completed' | 'failed' | 'expired' }>

/**
 * Process-wide exclusive coordinator for `dev.reset_app_data`.
 * Not a LifecycleManager.stop() wrapper — owns its own barrier order and
 * fail-closed semantics after destructive deletion begins.
 */
class DevResetCoordinatorImpl {
  private inProgress = false
  private jobHold: Disposable | undefined
  private cacheClosed = false
  private knowledgeGated = false
  private fileManagerGated = false
  private fileStorageGated = false
  private vectorLatched = false
  private mcpLatched = false
  private backupFenced = false

  async reset(): Promise<{ ok: true; restartRequired: true }> {
    if (this.inProgress) {
      throw devResetError(DevResetErrorCode.DEV_RESET_BUSY, 'A dev reset is already in progress')
    }
    this.inProgress = true
    this.resetFlags()

    let terminalJournal: TerminalJournal | undefined
    let destructiveStarted = false

    try {
      // 1. Backup fence BEFORE the first await — reject new export/restore, then
      // drain any already-admitted op, then prove the slot is empty.
      const backup = application.get('BackupService')
      backup.acquireDevResetFence()
      this.backupFenced = true
      await backup.drainForDevReset()
      backup.assertIdleForDevReset()

      // 2. Journal hard guard — no mutations on pending/corrupt
      const journalRead = readRestoreJournal()
      if (journalRead.kind === 'corrupt') {
        throw devResetError(
          DevResetErrorCode.DEV_RESET_RESTORE_PENDING,
          `Restore journal is corrupt: ${journalRead.error}`
        )
      }
      if (journalRead.kind === 'ok') {
        const state = journalRead.journal.state
        if (state === 'staged' || state === 'promoting') {
          throw devResetError(DevResetErrorCode.DEV_RESET_RESTORE_PENDING, `Restore journal is ${state}; refuse reset`)
        }
        if (state === 'completed' || state === 'failed' || state === 'expired') {
          terminalJournal = journalRead.journal
        }
      }

      // 3. Mutation gates + drain
      const knowledge = application.get('KnowledgeService')
      knowledge.acquireDevResetMutationGate()
      this.knowledgeGated = true
      const fileManager = application.get('FileManager')
      fileManager.acquireDevResetMutationGate()
      this.fileManagerGated = true
      fileStorage.acquireDevResetMutationGate()
      this.fileStorageGated = true

      await knowledge.drainDevResetMutations()
      await fileManager.drainDevResetMutations()
      await fileStorage.drainDevResetMutations()

      // 4. JobManager pause + drain
      const jobManager = application.get('JobManager')
      this.jobHold = jobManager.pause('dev reset')
      const verdict = await jobManager.drainInFlight({ timeoutMs: JOB_DRAIN_TIMEOUT_MS })
      if (verdict.stragglerIds.length > 0 || verdict.startupRecoveryPending) {
        throw devResetError(
          DevResetErrorCode.DEV_RESET_QUIESCE_FAILED,
          'JobManager did not drain cleanly for dev reset',
          verdict
        )
      }

      // 5. Vector strict close
      const vectorStoreService = application.get('KnowledgeVectorStoreService')
      this.vectorLatched = true
      await vectorStoreService.closeAllForDevReset()

      // 6. MCP close — a failure here (stuck OAuth / hung client.close / drain
      // timeout) means the MCP latch refuses release. Route to the force-exit
      // catch instead of rollback: rolling back leaves quarantined MCP + pending
      // transports on a live process (expiry -> refused release -> force-exit).
      const mcpRuntimeService = application.get('McpRuntimeService')
      this.mcpLatched = true
      try {
        await mcpRuntimeService.closeAllForDevReset()
      } catch (error) {
        // Force the destructive-phase catch (force-exit, no rollback). MCP close
        // failure must not leave a usable process with an unknown transport state.
        destructiveStarted = true
        throw error
      }

      // 7. CacheService strict close (not lifecycle stop — that swallows errors)
      this.cacheClosed = true
      await application.get('CacheService').closeForDevReset()

      // 8. Db close + sync destructive section (no await between close and deletes)
      // Enter the destructive phase before the close proof: a step-8 failure is
      // fail-closed even when the filesystem deletion has not started yet.
      destructiveStarted = true
      const dbService = application.get('DbService')
      dbService.closeForDevReset()
      this.deleteDatabaseAndData()

      // 9. Terminal restore artifacts
      clearTerminalRestoreArtifacts(terminalJournal)

      // Success: retain holds/latches. Relaunch must succeed or we fatal-exit —
      // never report completed reset while leaving a dead writable process.
      logger.info('Dev reset completed; relaunching application')
      try {
        application.relaunch()
      } catch (error) {
        logger.error('Failed to relaunch after successful dev reset; forcing exit', error as Error)
        app.exit(1)
        throw devResetError(
          DevResetErrorCode.DEV_RESET_INCOMPLETE,
          error instanceof Error ? error.message : String(error)
        )
      }
      // Watchdog: if relaunch did not exit (e.g. test mock), force exit so we
      // never sit on a wiped DB pretending the reset completed for a live UI.
      setTimeout(() => {
        logger.error('Process still alive after relaunch; forcing exit')
        app.exit(1)
      }, RELAUNCH_WATCHDOG_MS).unref()
      return { ok: true, restartRequired: true }
    } catch (error) {
      if (destructiveStarted) {
        logger.error('Dev reset failed after entering the destructive phase', error as Error)
        // Keep exclusivity / holds / latches — fail-closed. Uncertain DB close
        // (or any post-destructive failure) must not leave a usable process.
        setTimeout(() => {
          logger.error('Forcing exit after incomplete destructive reset')
          app.exit(1)
        }, 100).unref()
        throw devResetError(
          DevResetErrorCode.DEV_RESET_INCOMPLETE,
          error instanceof Error ? error.message : String(error)
        )
      }
      await this.rollbackPreDestructive()
      throw error
    }
  }

  private deleteDatabaseAndData(): void {
    const dbPath = application.getPath('app.database.file')
    const dataDir = application.getPath('app.userdata.data')
    for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      fs.rmSync(target, { force: true })
    }
    fs.rmSync(dataDir, { recursive: true, force: true })
  }

  private async rollbackPreDestructive(): Promise<void> {
    try {
      if (this.cacheClosed) {
        await application.get('CacheService').reopenAfterDevResetFailure()
        this.cacheClosed = false
      }
    } catch (error) {
      logger.error('Failed to reopen CacheService after pre-destructive reset failure', error as Error)
    }

    // MCP latch release is a no-op when closeAll failed (quarantine until restart).
    if (this.mcpLatched) {
      application.get('McpRuntimeService').releaseDevResetLatch()
      this.mcpLatched = false
    }
    if (this.vectorLatched) {
      application.get('KnowledgeVectorStoreService').releaseDevResetLatch()
      this.vectorLatched = false
    }

    this.jobHold?.dispose()
    this.jobHold = undefined

    if (this.fileStorageGated) {
      fileStorage.releaseDevResetMutationGate()
      this.fileStorageGated = false
    }
    if (this.fileManagerGated) {
      application.get('FileManager').releaseDevResetMutationGate()
      this.fileManagerGated = false
    }
    if (this.knowledgeGated) {
      application.get('KnowledgeService').releaseDevResetMutationGate()
      this.knowledgeGated = false
    }

    if (this.backupFenced) {
      application.get('BackupService').releaseDevResetFence()
      this.backupFenced = false
    }

    this.inProgress = false
  }

  private resetFlags(): void {
    this.jobHold = undefined
    this.cacheClosed = false
    this.knowledgeGated = false
    this.fileManagerGated = false
    this.fileStorageGated = false
    this.vectorLatched = false
    this.mcpLatched = false
    this.backupFenced = false
  }
}

export const DevResetCoordinator = new DevResetCoordinatorImpl()
