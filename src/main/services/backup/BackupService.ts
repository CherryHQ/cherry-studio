import type { PromotionStepV2, RestoreJournalV2, RestoreJournalV2State } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { BackupBusyError } from './errors'
import { type ExportArchiveResult, exportLiteArchive } from './exportArchive'
import { armPreparedRestore, cancelPreparedRestore, prepareLiteRestore, type RestorePreview } from './prepareRestore'

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
  private operation: BackupOperation | null = null

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

  public getStatus(): BackupStatus {
    return { operation: this.operation, restore: this.getRestoreStatus() }
  }

  /**
   * Export a Lite archive to `outPath`. The destination must not exist — this
   * never overwrites a prior backup.
   */
  public exportLite(outPath: string, signal?: AbortSignal): Promise<ExportArchiveResult> {
    return this.runExclusive('export', () => exportLiteArchive({ outPath, signal }))
  }

  /**
   * Admit an archive and stage a cancellable `prepared` restore. Mutates no live
   * state; {@link armRestore} is what commits to it.
   */
  public prepareRestore(archivePath: string, signal?: AbortSignal): Promise<RestorePreview> {
    return this.runExclusive('prepare-restore', () => prepareLiteRestore({ archivePath, signal }))
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
   * Run `work` as THE backup operation, rejecting a second one with
   * {@link BackupBusyError}.
   *
   * Export and restore preparation both write into the same staging root and
   * both snapshot the database, so overlapping them would let one operation's
   * cleanup delete the other's staging tree. The claim is synchronous — checked
   * and taken before any `await` — so two callers in the same tick cannot both
   * pass the guard.
   */
  public async runExclusive<T>(operation: BackupOperation, work: () => Promise<T>): Promise<T> {
    if (this.operation !== null) {
      throw new BackupBusyError(this.operation, operation)
    }
    this.operation = operation
    try {
      return await work()
    } finally {
      this.operation = null
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
