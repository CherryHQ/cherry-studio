import { and, desc, eq, notInArray } from 'drizzle-orm'

import { application } from '@application'
import { agentBackgroundTaskTable } from '@data/db/schemas/agentBackgroundTask'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import type { BackgroundTaskRecord } from '@shared/ai/backgroundTask'

const logger = loggerService.withContext('AgentBackgroundTaskService')

/** One deferred index write, replayed against its agent once writes resume. */
interface DeferredIndex {
  agentId: string
  record: BackgroundTaskRecord
}

/**
 * Owns the durable index of detached task status; task log and exit sentinel remain on disk.
 *
 * A detached task can finish while backup or restore has paused and drained the writers to take a
 * consistent database fingerprint, and a completion landing then would change that fingerprint and
 * reject the backup — or expire a staged restore on the next restart. The disk record and sentinel
 * still carry the evidence, so an index write arriving inside such a window is held here and
 * replayed once the hold is released.
 */
export class AgentBackgroundTaskService {
  private readonly writeHolds = new Set<symbol>()
  private readonly deferred: DeferredIndex[] = []

  /**
   * Freezes index writes for the duration of a backup or restore capture. Returns a Disposable
   * whose release replays everything that arrived while frozen.
   */
  pauseWrites(reason?: string): { dispose(): void } {
    const token = Symbol(reason ?? 'background-task-index-pause')
    this.writeHolds.add(token)
    logger.info('Background task index writes paused', { reason: reason ?? null })
    return {
      dispose: () => {
        if (!this.writeHolds.delete(token)) return
        if (this.writeHolds.size > 0) return
        logger.info('Background task index writes resumed', { reason: reason ?? null })
        this.replayDeferred()
      }
    }
  }

  saveRecord(agentId: string, record: BackgroundTaskRecord): void {
    if (this.writeHolds.size > 0) {
      // The task's own record and sentinel are already on disk, so the evidence survives the
      // window; only the index waits for it.
      this.deferred.push({ agentId, record })
      return
    }
    // One already-atomic upsert; only the batch below needs a wrapping transaction.
    this.upsertTx(application.get('DbService').getDb(), agentId, record)
  }

  /**
   * Index a whole reconciliation in one transaction. The panel polls every three seconds, so one
   * transaction per record turned a steady-state poll into a write burst that grew with the number
   * of finished tasks, all of it re-writing rows that had not changed. Rows whose disk records are
   * gone — every row, when the snapshot is empty — are swept in the same transaction, so the index
   * can never keep serving a task the disk no longer holds.
   */
  saveRecords(agentId: string, records: BackgroundTaskRecord[]): void {
    if (this.writeHolds.size > 0) {
      for (const record of records) this.deferred.push({ agentId, record })
      return
    }
    application.get('DbService').withWriteTx((tx) => {
      for (const record of records) {
        this.upsertTx(tx, agentId, record)
      }
      const ids = records.map((record) => record.id)
      const staleRows =
        ids.length === 0
          ? eq(agentBackgroundTaskTable.agentId, agentId)
          : and(eq(agentBackgroundTaskTable.agentId, agentId), notInArray(agentBackgroundTaskTable.id, ids))
      tx.delete(agentBackgroundTaskTable).where(staleRows).run()
    })
  }

  listByAgent(agentId: string): BackgroundTaskRecord[] {
    return application
      .get('DbService')
      .getDb()
      .select({ record: agentBackgroundTaskTable.record })
      .from(agentBackgroundTaskTable)
      .where(eq(agentBackgroundTaskTable.agentId, agentId))
      .orderBy(desc(agentBackgroundTaskTable.startedAt))
      .all()
      .map(({ record }) => record)
  }

  private replayDeferred(): void {
    if (this.deferred.length === 0) return
    const pending = this.deferred.splice(0, this.deferred.length)
    try {
      application.get('DbService').withWriteTx((tx) => {
        for (const { agentId, record } of pending) {
          this.upsertTx(tx, agentId, record)
        }
      })
    } catch (error) {
      logger.error('Failed to replay deferred background task index writes', { count: pending.length, error })
    }
  }

  private upsertTx(tx: DbOrTx, agentId: string, record: BackgroundTaskRecord): void {
    tx.insert(agentBackgroundTaskTable)
      .values({
        id: record.id,
        agentId,
        status: record.status,
        record,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt ?? null
      })
      .onConflictDoUpdate({
        target: agentBackgroundTaskTable.id,
        set: { status: record.status, record, finishedAt: record.finishedAt ?? null }
      })
      .run()
  }
}

export const agentBackgroundTaskService = new AgentBackgroundTaskService()
