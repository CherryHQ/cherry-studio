import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsAgentsTable } from './agentsAgents'

export const agentsTasksTable = sqliteTable(
  'agents_tasks',
  {
    id: text().primaryKey(),
    agentId: text().notNull(),
    name: text().notNull(),
    prompt: text().notNull(),
    scheduleType: text().notNull(),
    scheduleValue: text().notNull(),
    timeoutMinutes: integer().notNull().default(2),
    nextRun: text(),
    lastRun: text(),
    lastResult: text(),
    status: text().notNull().default('active'),
    ...createUpdateTimestamps
  },
  (t) => [
    foreignKey({
      columns: [t.agentId],
      foreignColumns: [agentsAgentsTable.id],
      name: 'agents_tasks_agent_id_fk'
    }).onDelete('cascade'),
    index('agents_tasks_agent_id_idx').on(t.agentId),
    index('agents_tasks_next_run_idx').on(t.nextRun),
    index('agents_tasks_status_idx').on(t.status)
  ]
)

export const agentsTaskRunLogsTable = sqliteTable(
  'agents_task_run_logs',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    taskId: text().notNull(),
    sessionId: text(),
    runAt: text().notNull(),
    durationMs: integer().notNull(),
    status: text().notNull(),
    result: text(),
    error: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    foreignKey({
      columns: [t.taskId],
      foreignColumns: [agentsTasksTable.id],
      name: 'agents_task_run_logs_task_id_fk'
    }).onDelete('cascade'),
    index('agents_task_run_logs_task_id_idx').on(t.taskId)
  ]
)

export type AgentsTaskRow = typeof agentsTasksTable.$inferSelect
export type InsertAgentsTaskRow = typeof agentsTasksTable.$inferInsert
export type AgentsTaskRunLogRow = typeof agentsTaskRunLogsTable.$inferSelect
export type InsertAgentsTaskRunLogRow = typeof agentsTaskRunLogsTable.$inferInsert
