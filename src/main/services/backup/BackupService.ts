import { application } from '@application'
import type { JournalDegradation, PromotionStepV2, RestoreJournalV2State } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { abandonKnowledgeRebuild, acknowledgeRestore, type AcknowledgeResult } from './acknowledgeRestore'
import { BackupBusyError, BackupCancelledError } from './errors'
import { exportArchive, type ExportArchiveResult } from './exportArchive'
import { sweepStaleExportOperations } from './exportOperation'
import { runPostPromotionWork } from './postPromotion'
import { armPreparedRestore, cancelPreparedRestore, prepareRestore, type RestorePreview } from './prepareRestore'
import { armRestoreRollback } from './rollbackRestore'

const logger = loggerService.withContext('BackupService')
const POST_PROMOTION_POLL_MS = 10_000

/**
 * Quiet window between `onAllReady` and the first reconciliation pass.
 *
 * `onAllReady` is a post-bootstrap supplement the framework does not await
 * (docs/references/lifecycle/lifecycle-usage.md), so work started inside it
 * lands on top of cold-start IO. This pass reads the database and talks to
 * `KnowledgeService`; nothing it produces is urgent — the jobs it enqueues wait
 * on JobManager's own 60s startup window regardless — so it yields the boot.
 */
const POST_PROMOTION_START_DELAY_MS = 5_000

/** The mutually exclusive long-running operations this service owns. */
export type BackupOperation = 'export' | 'prepare-restore'
export type KnowledgeRebuildAcknowledgement = 'require-complete' | 'abandon'

interface InFlightOperation {
  readonly operation: BackupOperation
  readonly controller: AbortController
  readonly settled: Promise<void>
}

/**
 * What the durable restore journal currently says, with the file itself hidden:
 * callers never learn its path, its format version, or that a corrupt one is
 * possible. The state machine (§6.1) is deliberately NOT hidden — `prepared` /
 * `armed` / `completed` are the vocabulary the restore UI and the promotion gate
 * both speak, so re-labelling it here would only add a translation to maintain.
 */
export type RestoreStatus =
  | { readonly kind: 'none' }
  /** The journal exists but no version can parse it; preboot preserves it and refuses unsafe startup. */
  | { readonly kind: 'unreadable' }
  | {
      readonly kind: 'journal'
      readonly state: RestoreJournalV2State
      readonly restoreId: string
      /** Present only while `state === 'promoting'`: the last completed promotion step. */
      readonly step?: PromotionStepV2
      /**
       * A `failed` restore whose rollback did not finish. Its asides are still
       * the only copy of what they hold, so nothing may be released until a
       * restart retries the rollback — the UI must not offer acknowledgement.
       */
      readonly recoveryIncomplete?: true
      /**
       * A `completed` restore whose resource units are not all installed. The
       * database is live, but the staging tree and the asides both have to stay
       * until a restart finishes the job — so acknowledgement is withheld.
       */
      readonly resourcesIncomplete?: true
      /** Knowledge jobs are still rebuilding archive-transported material. */
      readonly knowledgeRebuildPending?: true
      /**
       * What this restore reduced (§4), carried by the journal so the report
       * survives the relaunch. Absent when nothing was reduced.
       */
      readonly degradations?: readonly JournalDegradation[]
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
 * at preboot — see `core/preboot/backupRestoreGate.ts`), and journal/aside
 * cleanup, which belong to the promotion gate and to acknowledgement.
 */
@Injectable('BackupService')
@ServicePhase(Phase.WhenReady)
// Post-promotion rebuild and abandonment call `KnowledgeService` directly
// (§6.7), so it must be initialized before this service starts scheduling and —
// because the container stops dependents first — must still be alive while
// `onStop` joins the pass that is talking to it.
@DependsOn(['KnowledgeService'])
export class BackupService extends BaseService {
  /** The one operation in flight, with the handle that can abort it; `null` when idle. */
  private inFlight: InFlightOperation | null = null
  private shuttingDown = false
  /** The current bounded reconciliation pass, tracked so `onStop` can join it (§6.7). */
  private postPromotionWork: Promise<unknown> | null = null
  private exportCleanupWork: Promise<void> | null = null
  private postPromotionPoll: Disposable | null = null
  private postPromotionSuppressed = false

  protected onInit(): void {
    // Lifecycle services may be restarted on the same instance.
    this.shuttingDown = false
    this.postPromotionSuppressed = false
    this.exportCleanupWork = null
  }

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
        // The reason was already logged where it was still detailed; this line
        // exists to mark WHEN the app noticed.
        logger.error('Restore journal is unreadable — preboot will preserve it and refuse unsafe startup')
        return
      case 'journal':
        logger.info('Restore journal present at startup', {
          state: status.state,
          restoreId: status.restoreId,
          step: status.step
        })
        return
    }
  }

  /**
   * Rebuild what a completed restore left derived (§6.7). Runs here rather than
   * in the promotion because it needs the restored database live, the Knowledge
   * service running, and the job queue open — none of which exist at preboot.
   *
   * Scheduled, not run: see {@link POST_PROMOTION_START_DELAY_MS}. The timer is
   * handed to `BaseService` so a shutdown inside the window cancels it, and the
   * `shuttingDown` re-check covers the shutdown that races the callback itself.
   */
  protected onAllReady(): void {
    void this.startExportCleanup()
    const handle = setTimeout(() => this.startPostPromotionPass(), POST_PROMOTION_START_DELAY_MS)
    this.registerDisposable(() => clearTimeout(handle))
  }

  private startExportCleanup(): Promise<void> {
    if (this.exportCleanupWork) return this.exportCleanupWork
    this.exportCleanupWork = sweepStaleExportOperations(application.getPath('feature.backup.temp'))
      .then((removed) => {
        if (removed > 0) logger.info('Removed stale backup export operations', { removed })
      })
      .catch((error) => {
        // Ownership validation is fail-closed. Residue can stay for a later
        // retry, but cleanup must never keep backup/restore unavailable.
        logger.warn('Could not sweep stale backup export operations', error as Error)
      })
    return this.exportCleanupWork
  }

  private startPostPromotionPass(): void {
    if (this.shuttingDown || this.postPromotionSuppressed || this.postPromotionWork) return
    const work = runPostPromotionWork(() => !this.shuttingDown && !this.postPromotionSuppressed)
      .then((outcome) => {
        if (this.shuttingDown || this.postPromotionSuppressed) return
        if (outcome.pending) {
          this.postPromotionPoll ??= this.registerInterval(() => this.startPostPromotionPass(), POST_PROMOTION_POLL_MS)
        } else {
          this.postPromotionPoll?.dispose()
          this.postPromotionPoll = null
        }
      })
      .catch((error) => {
        // Derived work is a repair, never a boot dependency. Poll again: the
        // durable journal remains the source of truth until completion.
        logger.error('Post-promotion work failed', error as Error)
        if (!this.shuttingDown && !this.postPromotionSuppressed) {
          this.postPromotionPoll ??= this.registerInterval(() => this.startPostPromotionPass(), POST_PROMOTION_POLL_MS)
        }
      })
      .finally(() => {
        if (this.postPromotionWork === work) this.postPromotionWork = null
      })
    this.postPromotionWork = work
  }

  protected async onStop(): Promise<void> {
    this.shuttingDown = true
    this.postPromotionPoll?.dispose()
    this.postPromotionPoll = null
    const waits: Promise<unknown>[] = []
    if (this.inFlight) {
      this.inFlight.controller.abort()
      waits.push(this.inFlight.settled)
    }
    if (this.postPromotionWork) waits.push(this.postPromotionWork)
    if (this.exportCleanupWork) waits.push(this.exportCleanupWork)
    await Promise.all(waits)
  }

  public getStatus(): BackupStatus {
    return { operation: this.inFlight?.operation ?? null, restore: this.getRestoreStatus() }
  }

  /**
   * Export an archive to `outPath`. The destination must not exist — this never
   * overwrites a prior backup.
   */
  public export(outPath: string): Promise<ExportArchiveResult> {
    return this.runExclusive('export', async (signal) => {
      await this.startExportCleanup()
      return exportArchive({ outPath, signal })
    })
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

  /** Confirm exactly the prepared restore whose preview the user accepted. */
  public armRestore(restoreId: string): void {
    armPreparedRestore(restoreId)
  }

  /** Restore the data retained before the last completed restore, then relaunch. */
  public rollbackRestore(): void {
    armRestoreRollback()
  }

  /**
   * Commit to a finished restore or rollback: drop its displaced side and
   * release the GC protection it held (§6.5). Idempotent, and refuses an action
   * that has not finished — that one still needs its recovery artifacts.
   */
  public async acknowledgeRestore(knowledgeRebuild: KnowledgeRebuildAcknowledgement): Promise<AcknowledgeResult> {
    if (knowledgeRebuild === 'abandon') {
      // Stop the scheduler first, then persist the user's choice. A pass already
      // inside one base sees the suppression probe before moving to another;
      // waiting for that bounded pass closes the enqueue-vs-cancel race.
      this.postPromotionSuppressed = true
      this.postPromotionPoll?.dispose()
      this.postPromotionPoll = null
      let abandoned: ReturnType<typeof abandonKnowledgeRebuild>
      try {
        abandoned = abandonKnowledgeRebuild()
      } catch (error) {
        this.postPromotionSuppressed = false
        throw error
      }
      if (this.postPromotionWork) await this.postPromotionWork
      try {
        await application.get('KnowledgeService').cancelRestoredMaterialRebuild(abandoned.restoreId)
      } catch (error) {
        // This is derived work after an explicit give-up. A cancellation
        // bookkeeping failure cannot keep rollback storage and GC protection
        // hostage; active handlers are still restore-scoped and write only the
        // live derived index if they eventually settle.
        logger.warn('Could not cancel every abandoned restore indexing job', error as Error, {
          restoreId: abandoned.restoreId,
          pendingBases: abandoned.pendingBaseIds.length
        })
      }
    }
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
    if (this.shuttingDown) throw new BackupCancelledError('backup service is shutting down')
    if (this.inFlight !== null) {
      throw new BackupBusyError(this.inFlight.operation, operation)
    }
    const controller = new AbortController()
    let markSettled = (): void => {}
    const claim: InFlightOperation = {
      operation,
      controller,
      settled: new Promise<void>((resolve) => {
        markSettled = resolve
      })
    }
    this.inFlight = claim
    try {
      return await work(controller.signal)
    } finally {
      if (this.inFlight === claim) this.inFlight = null
      markSettled()
    }
  }

  private getRestoreStatus(): RestoreStatus {
    const read = readRestoreJournalV2()
    if (read.kind === 'none') {
      return { kind: 'none' }
    }
    if (read.kind === 'corrupt') {
      return { kind: 'unreadable' }
    }
    const journal = read.journal
    return {
      kind: 'journal',
      state: journal.state,
      restoreId: journal.restoreId,
      ...(journal.state === 'promoting' ? { step: journal.step } : {}),
      ...(journal.state === 'failed' && journal.recoveryIncomplete ? { recoveryIncomplete: true as const } : {}),
      ...(journal.state === 'completed' && journal.resourcesIncomplete ? { resourcesIncomplete: true as const } : {}),
      ...(journal.state === 'completed' &&
      !journal.knowledgeRebuild?.abandoned &&
      journal.summary.knowledgeBaseIds.some((id) => !journal.knowledgeRebuild?.completedBaseIds.includes(id))
        ? { knowledgeRebuildPending: true as const }
        : {}),
      ...(journal.degradations && journal.degradations.length > 0 ? { degradations: journal.degradations } : {})
    }
  }
}
