import type { PromotionStepV2, RestoreJournalV2, RestoreJournalV2State } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { acknowledgeRestore, type AcknowledgeResult } from './acknowledgeRestore'
import { BackupBusyError } from './errors'
import { exportArchive, type ExportArchiveResult } from './exportArchive'
import type { BackupPreset } from './manifest'
import { runPostPromotionWork } from './postPromotion'
import { armPreparedRestore, cancelPreparedRestore, prepareRestore, type RestorePreview } from './prepareRestore'

const logger = loggerService.withContext('BackupService')

/** The mutually exclusive long-running operations this service owns. */
export type BackupOperation = 'export' | 'prepare-restore'

/**
 * What the durable restore journal currently says, with the file itself hidden:
 * callers never learn its path, its format version, or that a corrupt one is
 * possible. The state machine (§6.1) is deliberately NOT hidden — `prepared` /
 * `armed` / `completed` are the vocabulary the restore UI and the promotion gate
 * both speak, so re-labelling it here would only add a translation to maintain.
 */
export type RestoreStatus =
  | { readonly kind: 'none' }
  /** The journal exists but no version can parse it; the gate quarantines it at the next boot. */
  | { readonly kind: 'unreadable'; readonly error: string }
  | {
      readonly kind: 'journal'
      readonly state: RestoreJournalV2State
      readonly restoreId: string
      readonly preset: RestoreJournalV2['preset']
      /** Present only while `state === 'promoting'`: the last completed promotion step. */
      readonly step?: PromotionStepV2
    }

export interface BackupStatus {
  /** An in-flight operation in THIS process; `null` when idle. Not durable. */
  readonly operation: BackupOperation | null
  /** Durable, survives relaunch — the restore journal's view. */
  readonly restore: RestoreStatus
}

/**
 * Owner of the backup export and restore-preparation flows (Backup v2,
 * docs/references/backup/README.md).
 *
 * The service exists as the single place that serializes these operations and
 * reads the durable journal, so no caller has to coordinate. Its methods are the
 * API: the Phase 4 IPC layer delegates to them and adds nothing but sender
 * policy, schema validation, and error mapping, which is why tests here drive
 * the service directly instead of waiting for the renderer.
 *
 * What it deliberately does NOT own: the preboot promotion (no service is alive
 * at preboot — see `core/preboot/backupRestoreGate.ts`), and journal quarantine
 * or aside cleanup, which belong to the promotion gate and to acknowledgement.
 */
@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
export class BackupService extends BaseService {
  /** The one operation in flight, with the handle that can abort it; `null` when idle. */
  private inFlight: { readonly operation: BackupOperation; readonly controller: AbortController } | null = null
  private shuttingDown = false
  /** The post-promotion rebuild, tracked so `onStop` can join it (§6.7). */
  private postPromotionWork: Promise<unknown> | null = null

  /**
   * Report what the last boot's restore attempt left behind. Read-only on
   * purpose: by the time this runs, the preboot gate has already resolved (or
   * expired) any promotion, so acting on the journal here could only fight it.
   */
  protected onReady(): void {
    const status = this.getRestoreStatus()
    switch (status.kind) {
      case 'none':
        return
      case 'unreadable':
        logger.error('Restore journal is unreadable — the next boot gate will quarantine it', {
          error: status.error
        })
        return
      case 'journal':
        logger.info('Restore journal present at startup', {
          state: status.state,
          restoreId: status.restoreId,
          preset: status.preset,
          step: status.step
        })
        return
    }
  }

  /**
   * Rebuild what a completed restore left derived (§6.7). Runs here rather than
   * in the promotion because it needs the restored database live, the Knowledge
   * service running, and the job queue open — none of which exist at preboot.
   */
  protected onAllReady(): void {
    this.postPromotionWork = runPostPromotionWork(() => !this.shuttingDown).catch((error) => {
      // Derived work is a repair, never a boot dependency.
      logger.error('Post-promotion work failed', error as Error)
    })
  }

  protected async onStop(): Promise<void> {
    this.shuttingDown = true
    if (this.postPromotionWork) {
      await this.postPromotionWork
    }
  }

  public getStatus(): BackupStatus {
    return { operation: this.inFlight?.operation ?? null, restore: this.getRestoreStatus() }
  }

  /**
   * Export an archive to `outPath`. The destination must not exist — this never
   * overwrites a prior backup.
   */
  public export(outPath: string, preset: BackupPreset): Promise<ExportArchiveResult> {
    return this.runExclusive('export', (signal) => exportArchive({ outPath, preset, signal }))
  }

  /**
   * Admit an archive and stage a cancellable `prepared` restore. Mutates no live
   * state; {@link armRestore} is what commits to it.
   */
  public prepareRestore(archivePath: string): Promise<RestorePreview> {
    return this.runExclusive('prepare-restore', (signal) => prepareRestore({ archivePath, signal }))
  }

  /**
   * Ask the in-flight operation to stop; `false` when there was nothing running.
   *
   * The service owns the {@link AbortController} rather than taking a signal from
   * the caller, because the only caller that can ask for a stop is a *different*
   * IPC request than the one that started the work — there is no shared object
   * between them but this service.
   *
   * Abort is cooperative: each stage checks the signal at its own checkpoints and
   * unwinds its own partial work, so `true` means "the request was delivered",
   * not "it has stopped". The originating call reports the outcome.
   */
  public cancelOperation(): boolean {
    if (this.inFlight === null) {
      return false
    }
    logger.info('Cancelling backup operation', { operation: this.inFlight.operation })
    this.inFlight.controller.abort()
    return true
  }

  /**
   * Discard a prepared restore. Not routed through {@link runExclusive}: it is a
   * synchronous cleanup of state a finished preparation left behind, and making
   * it wait on an unrelated export would only strand the staging tree longer.
   */
  public cancelRestore(): void {
    cancelPreparedRestore()
  }

  /** Confirm a prepared restore and relaunch into promotion. */
  public armRestore(): void {
    armPreparedRestore()
  }

  /**
   * Commit to a finished restore: drop its recovery asides and release the GC
   * protection they held (§6.5). Idempotent, and refuses a restore that has not
   * finished — that one still needs its aside.
   */
  public acknowledgeRestore(): AcknowledgeResult {
    return acknowledgeRestore()
  }

  /**
   * Run `work` as THE backup operation, rejecting a second one with
   * {@link BackupBusyError}.
   *
   * Export and restore preparation both write into the same staging root and
   * both snapshot the database, so overlapping them would let one operation's
   * cleanup delete the other's staging tree. The claim is synchronous — checked
   * and taken before any `await` — so two callers in the same tick cannot both
   * pass the guard.
   *
   * `work` receives the signal that {@link cancelOperation} aborts. It is created
   * here so the claim and the abort handle have exactly the same lifetime: a
   * cancellation can never reach the operation that replaced the one it targeted.
   */
  public async runExclusive<T>(operation: BackupOperation, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.inFlight !== null) {
      throw new BackupBusyError(this.inFlight.operation, operation)
    }
    const controller = new AbortController()
    this.inFlight = { operation, controller }
    try {
      return await work(controller.signal)
    } finally {
      this.inFlight = null
    }
  }

  private getRestoreStatus(): RestoreStatus {
    const read = readRestoreJournalV2()
    if (read.kind === 'none') {
      return { kind: 'none' }
    }
    if (read.kind === 'corrupt') {
      return { kind: 'unreadable', error: read.error }
    }
    const journal = read.journal
    return {
      kind: 'journal',
      state: journal.state,
      restoreId: journal.restoreId,
      preset: journal.preset,
      ...(journal.state === 'promoting' ? { step: journal.step } : {})
    }
  }
}
