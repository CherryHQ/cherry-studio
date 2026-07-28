import {
  type JournalDegradation,
  type PromotionStep,
  readRestoreJournal,
  type RestoreJournalState
} from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { acknowledgeRestore, type AcknowledgeResult } from './acknowledgeRestore'
import { BackupBusyError, BackupCancelledError } from './errors'
import { exportArchive, type ExportArchiveResult } from './exportArchive'
import { armPreparedRestore, cancelPreparedRestore, prepareRestore, type RestorePreview } from './prepareRestore'
import { armRestoreRollback } from './rollbackRestore'

const logger = loggerService.withContext('BackupService')

export type BackupOperation = 'export' | 'prepare-restore'

interface InFlightOperation {
  readonly operation: BackupOperation
  readonly controller: AbortController
  readonly settled: Promise<void>
}

export type RestoreStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly error: string }
  | {
      readonly kind: 'journal'
      readonly state: RestoreJournalState
      readonly restoreId: string
      readonly step?: PromotionStep
      readonly degradations?: readonly JournalDegradation[]
    }

export interface BackupStatus {
  readonly operation: BackupOperation | null
  readonly restore: RestoreStatus
}

/** Owns exclusive Lite export and restore-preparation operations. */
@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
export class BackupService extends BaseService {
  private inFlight: InFlightOperation | null = null
  private shuttingDown = false

  protected onInit(): void {
    this.shuttingDown = false
  }

  protected onReady(): void {
    const status = this.getRestoreStatus()
    if (status.kind === 'unreadable') {
      logger.error('Restore journal is unreadable — preboot preserves it and refuses unsafe startup', {
        error: status.error
      })
    } else if (status.kind === 'journal') {
      logger.info('Restore journal present at startup', {
        state: status.state,
        restoreId: status.restoreId,
        step: status.step
      })
    }
  }

  protected async onStop(): Promise<void> {
    this.shuttingDown = true
    if (!this.inFlight) return
    this.inFlight.controller.abort()
    await this.inFlight.settled
  }

  public getStatus(): BackupStatus {
    return { operation: this.inFlight?.operation ?? null, restore: this.getRestoreStatus() }
  }

  public export(outPath: string): Promise<ExportArchiveResult> {
    return this.runExclusive('export', (signal) => exportArchive({ outPath, signal }))
  }

  public prepareRestore(archivePath: string): Promise<RestorePreview> {
    return this.runExclusive('prepare-restore', (signal) => prepareRestore({ archivePath, signal }))
  }

  public cancelOperation(): boolean {
    if (!this.inFlight) return false
    logger.info('Cancelling backup operation', { operation: this.inFlight.operation })
    this.inFlight.controller.abort()
    return true
  }

  public cancelRestore(): void {
    cancelPreparedRestore()
  }

  public armRestore(restoreId: string): void {
    armPreparedRestore(restoreId)
  }

  public rollbackRestore(): void {
    armRestoreRollback()
  }

  public acknowledgeRestore(): AcknowledgeResult {
    return acknowledgeRestore()
  }

  public async runExclusive<T>(operation: BackupOperation, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.shuttingDown) throw new BackupCancelledError('backup service is shutting down')
    if (this.inFlight) throw new BackupBusyError(this.inFlight.operation, operation)

    const controller = new AbortController()
    let settle = (): void => {}
    const claim: InFlightOperation = {
      operation,
      controller,
      settled: new Promise<void>((resolve) => {
        settle = resolve
      })
    }
    this.inFlight = claim
    try {
      return await work(controller.signal)
    } finally {
      if (this.inFlight === claim) this.inFlight = null
      settle()
    }
  }

  private getRestoreStatus(): RestoreStatus {
    const read = readRestoreJournal()
    if (read.kind === 'none') return { kind: 'none' }
    if (read.kind === 'corrupt') return { kind: 'unreadable', error: read.error }
    const journal = read.journal
    const step = 'step' in journal ? journal.step : undefined
    return {
      kind: 'journal',
      state: journal.state,
      restoreId: journal.restoreId,
      ...(step ? { step } : {}),
      ...(journal.degradations?.length ? { degradations: journal.degradations } : {})
    }
  }
}
