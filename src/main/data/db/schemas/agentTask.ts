import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentTable } from './agent'

export const agentTaskTable = sqliteTable(
  'agent_task',
  {
    id: text().primaryKey(),
    agentId: text().notNull(),
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
    foreignKey({
      columns: [t.agentId],
      foreignColumns: [agentTable.id],
      name: 'agent_task_agent_id_fk'
    }).onDelete('cascade'),
    index('agent_task_agent_id_idx').on(t.agentId),
    index('agent_task_next_run_idx').on(t.nextRun),
    index('agent_task_status_idx').on(t.status)
  ]
)

export const agentTaskRunLogTable = sqliteTable(
  'agent_task_run_log',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    taskId: text().notNull(),
    sessionId: text(),
    runAt: integer().notNull(),
    durationMs: integer().notNull(),
    status: text().notNull(),
    result: text(),
    error: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    foreignKey({
      columns: [t.taskId],
      foreignColumns: [agentTaskTable.id],
      name: 'agent_task_run_log_task_id_fk'
    }).onDelete('cascade'),
    index('agent_task_run_log_task_id_idx').on(t.taskId)
  ]
)

export type AgentTaskRow = typeof agentTaskTable.$inferSelect
export type InsertAgentTaskRow = typeof agentTaskTable.$inferInsert
export type AgentTaskRunLogRow = typeof agentTaskRunLogTable.$inferSelect
export type InsertAgentTaskRunLogRow = typeof agentTaskRunLogTable.$inferInsert
