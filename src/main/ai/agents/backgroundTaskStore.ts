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
    .map(({ record }) => record as BackgroundTaskRecord)
}
