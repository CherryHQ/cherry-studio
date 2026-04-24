import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { BackupOptions, RestoreOptions } from '@shared/backup'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'

import { BackupCancelledError, CancellationToken } from './CancellationToken'
import { BackupValidatorImpl } from './orchestrator/BackupValidator'
import { ExportOrchestrator } from './orchestrator/ExportOrchestrator'
import { ImportOrchestrator } from './orchestrator/ImportOrchestrator'
import { BackupProgressTracker } from './progress/BackupProgressTracker'

const logger = loggerService.withContext('BackupService')

interface ActiveOperation {
  tracker: BackupProgressTracker
  token: CancellationToken
}

@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['DbService', 'PreferenceService'])
export class BackupService extends BaseService {
  private readonly activeOps = new Map<string, ActiveOperation>()

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    this.startProgressBroadcast()
  }

  protected async onStop(): Promise<void> {
    for (const [, op] of this.activeOps) op.token.cancel()
    this.activeOps.clear()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(
      IpcChannel.BackupV2_StartBackup,
      async (_e, payload: { outputPath: string; options: BackupOptions }) => {
        const opId = uuidv4()
        const tracker = new BackupProgressTracker()
        const token = new CancellationToken()
        this.activeOps.set(opId, { tracker, token })

        const orchestrator = new ExportOrchestrator(tracker, token)
        orchestrator
          .execute(payload.outputPath, payload.options)
          .then((stats) => {
            logger.info('Backup completed', { backupId: opId, duration: stats.duration })
          })
          .catch((err) => {
            if (!(err instanceof BackupCancelledError)) {
              logger.error('Backup failed', err as Error)
              tracker.reportError(err as Error)
            }
          })
          .finally(() => this.activeOps.delete(opId))

        return { backupId: opId }
      }
    )

    this.ipcHandle(IpcChannel.BackupV2_CancelBackup, async (_e, payload: { operationId: string }) => {
      const op = this.activeOps.get(payload.operationId)
      if (op) {
        op.token.cancel()
        return { cancelled: true }
      }
      return { cancelled: false }
    })

    this.ipcHandle(
      IpcChannel.BackupV2_StartRestore,
      async (_e, payload: { zipPath: string; options: RestoreOptions }) => {
        const opId = uuidv4()
        const tracker = new BackupProgressTracker()
        const token = new CancellationToken()
        this.activeOps.set(opId, { tracker, token })

        const orchestrator = new ImportOrchestrator(tracker, token)
        orchestrator
          .execute(payload.zipPath, payload.options)
          .then((stats) => {
            logger.info('Restore completed', { restoreId: opId, duration: stats.duration })
          })
          .catch((err) => {
            if (!(err instanceof BackupCancelledError)) {
              logger.error('Restore failed', err as Error)
              tracker.reportError(err as Error)
            }
          })
          .finally(() => this.activeOps.delete(opId))

        return { restoreId: opId }
      }
    )

    this.ipcHandle(IpcChannel.BackupV2_CancelRestore, async (_e, payload: { operationId: string }) => {
      const op = this.activeOps.get(payload.operationId)
      if (op) {
        op.token.cancel()
        return { cancelled: true }
      }
      return { cancelled: false }
    })

    this.ipcHandle(IpcChannel.BackupV2_ValidateBackup, async (_e, payload: { zipPath: string }) => {
      const validator = new BackupValidatorImpl()
      return validator.validate(payload.zipPath)
    })

    this.ipcHandle(IpcChannel.BackupV2_GetBackupProgress, async (_e, payload: { operationId: string }) => {
      const op = this.activeOps.get(payload.operationId)
      return op ? op.tracker.getBackupProgress() : null
    })

    this.ipcHandle(IpcChannel.BackupV2_GetRestoreProgress, async (_e, payload: { operationId: string }) => {
      const op = this.activeOps.get(payload.operationId)
      return op ? op.tracker.getRestoreProgress() : null
    })
  }

  private startProgressBroadcast(): void {
    const interval = setInterval(() => {
      for (const [id, op] of this.activeOps) {
        const progress = op.tracker.getBackupProgress()
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('backup-v2:progress', { operationId: id, ...progress })
          }
        })
      }
    }, 200)
    this.registerDisposable(() => clearInterval(interval))
  }
}
