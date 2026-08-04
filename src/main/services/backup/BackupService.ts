import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'

import { application } from '@application'
import type { JournalDegradation, PromotionStepV2, RestoreJournalV2State } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { BackupDestinationId } from '@shared/ipc/schemas/backup'
import { ensureDir, remove } from 'fs-extra'

import { archiveName, pruneToLimit, sanitizeArchiveName } from './destinations/archiveRotation'
import { resolveDestination } from './destinations/destinationConfig'
import { createTransport, type RemoteArchive } from './destinations/destinationTransport'
import { BackupBusyError, BackupCancelledError } from './errors'
import { exportArchive, type ExportArchiveResult } from './export/exportArchive'
import { sweepStaleExportOperations } from './export/exportOperation'
import { abandonKnowledgeRebuild, acknowledgeRestore, type AcknowledgeResult } from './restore/acknowledgeRestore'
import { runPostPromotionWork } from './restore/postPromotion'
import {
  armPreparedRestore,
  cancelPreparedRestore,
  prepareRestore,
  type RestorePreview
} from './restore/prepareRestore'
import { readRestoreKnowledgeProgress, readRestoreKnowledgeReadiness } from './restore/restoreOwnerReadiness'
import { armRestoreRollback } from './restore/rollbackRestore'

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
export type BackupOperation = 'export' | 'prepare-restore' | 'arm-restore' | 'rollback-restore'
export type KnowledgeRebuildAcknowledgement = 'require-complete' | 'abandon'

interface InFlightOperation {
  readonly operation: BackupOperation
  readonly controller: AbortController
  readonly cancellable: boolean
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
// Post-promotion work calls KnowledgeService. The owner must be initialized
// before BackupService starts and remain alive until BackupService has stopped.
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
      if (this.inFlight.cancellable) this.inFlight.controller.abort()
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
   * Export, upload, then prune — in that order, to a destination whose settings
   * this process reads for itself.
   *
   * The archive is built into the app's own temp area and moved out from there,
   * never written to the destination directly. That is what lets a backup folder
   * live on a NAS or a USB stick: the export's atomic publication needs a hard
   * link, which those filesystems do not have, so it happens on a local disk and
   * only the finished file crosses over.
   */
  public async exportToDestination(
    id: BackupDestinationId,
    customName?: string
  ): Promise<{ name: string; degradations: ExportArchiveResult['manifest']['degradations'] }> {
    // Resolved before the claim: an unconfigured destination is not an operation,
    // and must not make a concurrent export look busy.
    const destination = await resolveDestination(id)
    const transport = createTransport(destination)

    return this.runExclusive('export', async (signal) => {
      await this.startExportCleanup()
      // A name the user typed is kept, but it opts out of rotation: only the
      // generated convention identifies an archive as this device's.
      const name = customName ? sanitizeArchiveName(customName) : archiveName(new Date())
      const tempRoot = application.getPath('feature.backup.temp')
      // Neither the export's staging nor its publish link creates this; the
      // dialog-driven export never needed it because the user picks an existing
      // folder.
      await ensureDir(tempRoot)
      const stagePath = join(tempRoot, `${randomUUID()}-${name}`)
      try {
        const result = await exportArchive({ outPath: stagePath, signal })
        await transport.upload(result.outPath, name)
        // Only now. Pruning first is how a limit of 1 turned a failed upload into
        // a user with no backups at all.
        await pruneToLimit(transport, destination.maxBackups)
        return { name, degradations: result.manifest.degradations }
      } finally {
        await remove(stagePath).catch(() => {})
      }
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
   * Download an archive from a destination and stage it, exactly as if the user
   * had picked the file locally. The download is discarded before this returns —
   * {@link armRestore} runs from the staged copy, so keeping it would only hold
   * a second full-size copy for the length of the user's decision.
   */
  public async prepareRestoreFromDestination(id: BackupDestinationId, name: string): Promise<RestorePreview> {
    const transport = createTransport(await resolveDestination(id))

    return this.runExclusive('prepare-restore', async (signal) => {
      const downloadDir = join(application.getPath('feature.backup.temp'), `download-${randomUUID()}`)
      const archivePath = join(downloadDir, basename(name))
      try {
        await ensureDir(downloadDir)
        await transport.download(name, archivePath)
        return await prepareRestore({ archivePath, signal })
      } finally {
        await remove(downloadDir).catch(() => {})
      }
    })
  }

  /**
   * Everything sitting at a destination, newest first.
   *
   * Deliberately NOT narrowed to this device the way rotation is: restoring
   * another machine's backup, or one the user named themselves, is the point of
   * a shared folder. Only deletion is device-scoped.
   *
   * Not exclusive either — listing reads nothing an export or a restore is
   * writing, and making the picker wait on a running backup would only look
   * broken.
   */
  public async listDestinationBackups(id: BackupDestinationId): Promise<RemoteArchive[]> {
    const transport = createTransport(await resolveDestination(id))
    const archives = await transport.list()
    return [...archives].sort((a, b) => b.modifiedAt - a.modifiedAt)
  }

  public async deleteDestinationBackup(id: BackupDestinationId, name: string): Promise<void> {
    const transport = createTransport(await resolveDestination(id))
    await transport.remove(name)
  }

  /** Are the stored settings usable? A refusal is an answer here, not a fault. */
  public async checkDestination(id: BackupDestinationId): Promise<boolean> {
    const transport = createTransport(await resolveDestination(id))
    try {
      return await transport.check()
    } catch (error) {
      logger.warn('Backup destination is unreachable', error as Error, { destination: id })
      return false
    }
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
    if (this.inFlight === null || !this.inFlight.cancellable) {
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
  public armRestore(restoreId: string): Promise<void> {
    return this.runExclusive('arm-restore', () => armPreparedRestore(restoreId), { cancellable: false })
  }

  /** Restore the data retained before the last completed restore, then relaunch. */
  public rollbackRestore(): Promise<void> {
    return this.runExclusive('rollback-restore', () => armRestoreRollback(), { cancellable: false })
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
  public async runExclusive<T>(
    operation: BackupOperation,
    work: (signal: AbortSignal) => Promise<T>,
    options: { readonly cancellable?: boolean } = {}
  ): Promise<T> {
    if (this.shuttingDown) throw new BackupCancelledError('backup service is shutting down')
    if (this.inFlight !== null) {
      throw new BackupBusyError(this.inFlight.operation, operation)
    }
    const controller = new AbortController()
    let markSettled = (): void => {}
    const claim: InFlightOperation = {
      operation,
      controller,
      cancellable: options.cancellable ?? true,
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
    const knowledgeReadiness = journal.state === 'completed' ? readRestoreKnowledgeReadiness(journal) : null
    const knowledgeProgress =
      journal.state === 'completed' && knowledgeReadiness?.kind === 'ok'
        ? readRestoreKnowledgeProgress(journal, knowledgeReadiness.summary)
        : null
    const knowledgeRebuildPending =
      journal.state === 'completed' &&
      (knowledgeReadiness?.kind !== 'ok' ||
        knowledgeProgress?.kind !== 'ok' ||
        (!knowledgeProgress.progress.abandoned &&
          knowledgeReadiness.summary.rebuildBaseIds.length > 0 &&
          knowledgeReadiness.summary.rebuildBaseIds.some(
            (id) => !knowledgeProgress.progress.completedBaseIds.includes(id)
          )))
    return {
      kind: 'journal',
      state: journal.state,
      restoreId: journal.restoreId,
      ...(journal.state === 'promoting' ? { step: journal.step } : {}),
      ...(journal.state === 'failed' && journal.recoveryIncomplete ? { recoveryIncomplete: true as const } : {}),
      ...(journal.state === 'completed' && journal.resourcesIncomplete ? { resourcesIncomplete: true as const } : {}),
      ...(knowledgeRebuildPending ? { knowledgeRebuildPending: true as const } : {}),
      ...(journal.degradations && journal.degradations.length > 0 ? { degradations: journal.degradations } : {})
    }
  }
}
