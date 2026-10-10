import { and, desc, eq, notInArray } from 'drizzle-orm'

import { application } from '@application'
import { agentBackgroundTaskTable } from '@data/db/schemas/agentBackgroundTask'
import type { DbOrTx } from '@data/db/types'
import type { BackgroundTaskRecord } from '@shared/ai/backgroundTask'

/** Owns the durable index of detached task status; task log and exit sentinel remain on disk. */
export class AgentBackgroundTaskService {
  saveRecord(agentId: string, record: BackgroundTaskRecord): void {
    // One already-atomic upsert; only the batch below needs a wrapping transaction.
    this.upsertTx(application.get('DbService').getDb(), agentId, record)
  }

  /**
   * Index a whole reconciliation in one transaction. The panel polls every three seconds, so one
   * transaction per record turned a steady-state poll into a write burst that grew with the number
   * of finished tasks, all of it re-writing rows that had not changed. Rows whose disk records are
   * gone — every row, when the snapshot is empty — are swept in the same transaction, so the
   * index can never keep serving a task the disk no longer holds.
   */
  saveRecords(agentId: string, records: BackgroundTaskRecord[]): void {
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
