import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentTable } from './agent'

export const agentTaskTable = sqliteTable(
  'agent_task',
  {
    // IDs use the app-generated "task_<timestamp>_<random>" format, not UUIDs,
    // so uuidPrimaryKey() is intentionally not used here. Callers must always supply an id.
    id: text().primaryKey(),
    agentId: text()
      .notNull()
      .references(() => agentTable.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    prompt: text().notNull(),
    scheduleType: text().notNull(),
    scheduleValue: text().notNull(),
    timeoutMinutes: integer().notNull().default(2),
    nextRun: integer(),
    lastRun: integer(),
    lastResult: text(),
    status: text().notNull().default('active'),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_task_agent_id_idx').on(t.agentId),
    index('agent_task_next_run_idx').on(t.nextRun),
    index('agent_task_status_idx').on(t.status),
    check('agent_task_schedule_type_check', sql`${t.scheduleType} IN ('cron', 'interval', 'once')`),
    check('agent_task_status_check', sql`${t.status} IN ('active', 'paused', 'completed')`)
  ]
)

export const agentTaskRunLogTable = sqliteTable(
  'agent_task_run_log',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    taskId: text()
      .notNull()
      .references(() => agentTaskTable.id, { onDelete: 'cascade' }),
    sessionId: text(),
    runAt: integer().notNull(),
    durationMs: integer().notNull(),
    status: text().notNull(),
    result: text(),
    error: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_task_run_log_task_id_idx').on(t.taskId),
    check('agent_task_run_log_status_check', sql`${t.status} IN ('running', 'success', 'error')`)
  ]
)

export type AgentTaskRow = typeof agentTaskTable.$inferSelect
export type InsertAgentTaskRow = typeof agentTaskTable.$inferInsert
export type AgentTaskRunLogRow = typeof agentTaskRunLogTable.$inferSelect
export type InsertAgentTaskRunLogRow = typeof agentTaskRunLogTable.$inferInsert
