import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsAgentsTable } from './agentsAgents'

export const agentsTasksTable = sqliteTable(
  'agents_tasks',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    scheduleType: text('schedule_type').notNull(),
    scheduleValue: text('schedule_value').notNull(),
    timeoutMinutes: integer('timeout_minutes').notNull().default(2),
    nextRun: text('next_run'),
    lastRun: text('last_run'),
    lastResult: text('last_result'),
    status: text('status').notNull().default('active'),
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
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: text('task_id').notNull(),
    sessionId: text('session_id'),
    runAt: text('run_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    status: text('status').notNull(),
    result: text('result'),
    error: text('error')
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
