import { desc, eq } from 'drizzle-orm'

import { application } from '@application'
import { agentBackgroundTaskTable } from '@data/db/schemas/agentBackgroundTask'

import type { BackgroundTaskRecord } from './backgroundTasks'

/** SQLite index is the GUI/query source; task log and exit sentinel remain on disk. */
export function saveBackgroundTaskRecord(agentId: string, record: BackgroundTaskRecord): void {
  application.get('DbService').withWriteTx((tx) => {
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
  })
}

export function listBackgroundTaskRecords(agentId: string): BackgroundTaskRecord[] {
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

/**
 * Index a whole reconciliation in one transaction. The panel polls every three seconds, so one
 * transaction per record turned a steady-state poll into a write burst that grew with the number of
 * finished tasks, all of it re-writing rows that had not changed.
 */
export function saveBackgroundTaskRecords(agentId: string, records: BackgroundTaskRecord[]): void {
  if (records.length === 0) return
  application.get('DbService').withWriteTx((tx) => {
    for (const record of records) {
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
  })
}
