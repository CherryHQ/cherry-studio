import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type { DashboardStatus } from '@shared/data/api/schemas/agentTaskDashboard'

import { uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentSessionTable } from './agentSession'
import { jobScheduleTable } from './job'

export const agentTaskRunTable = sqliteTable(
  'agent_task_run',
  {
    id: uuidPrimaryKey(),
    source: text({ enum: ['scheduled', 'agent'] }).notNull(),
    runId: text().notNull(),
    taskId: text().references(() => jobScheduleTable.id, { onDelete: 'set null' }),
    sessionId: text().references(() => agentSessionTable.id, { onDelete: 'set null' }),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    nameSnapshot: text().notNull(),
    agentNameSnapshot: text().notNull(),
    messageAnchor: text(),
    startedAt: integer(),
    endedAt: integer(),
    lastActivityAt: integer(),
    status: text().$type<DashboardStatus>().notNull().default('running'),
    blockedOn: text({ enum: ['approval'] }),
    reasonCode: text(),
    errorSummary: text(),
    viewedAt: integer()
  },
  (t) => [
    uniqueIndex('agent_task_run_source_run_idx').on(t.source, t.runId),
    index('agent_task_run_awaiting_idx')
      .on(t.endedAt, t.id)
      .where(sql`${t.viewedAt} IS NULL AND ${t.endedAt} IS NOT NULL`),
    index('agent_task_run_session_idx').on(t.sessionId),
    index('agent_task_run_task_idx').on(t.taskId),
    index('agent_task_run_status_idx').on(t.status),
    check('agent_task_run_status_check', sql`${t.status} IN ('queued','running','succeeded','failed','cancelled')`)
  ]
)

export type AgentTaskRunRow = typeof agentTaskRunTable.$inferSelect
export type InsertAgentTaskRunRow = typeof agentTaskRunTable.$inferInsert
