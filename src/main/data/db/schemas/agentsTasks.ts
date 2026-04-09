import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsAgentsTable } from './agentsAgents'

export const agentsTasksTable = sqliteTable(
  'agents_tasks',
  {
    id: text().primaryKey(),
    agent_id: text().notNull(),
    name: text().notNull(),
    prompt: text().notNull(),
    schedule_type: text().notNull(),
    schedule_value: text().notNull(),
    timeout_minutes: integer().notNull().default(2),
    next_run: text(),
    last_run: text(),
    last_result: text(),
    status: text().notNull().default('active'),
    created_at: text().notNull(),
    updated_at: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.agent_id],
      foreignColumns: [agentsAgentsTable.id],
      name: 'agents_tasks_agent_id_fk'
    }).onDelete('cascade'),
    index('agents_tasks_agent_id_idx').on(t.agent_id),
    index('agents_tasks_next_run_idx').on(t.next_run),
    index('agents_tasks_status_idx').on(t.status)
  ]
)

export const agentsTaskRunLogsTable = sqliteTable(
  'agents_task_run_logs',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    task_id: text().notNull(),
    session_id: text(),
    run_at: text().notNull(),
    duration_ms: integer().notNull(),
    status: text().notNull(),
    result: text(),
    error: text()
  },
  (t) => [
    foreignKey({
      columns: [t.task_id],
      foreignColumns: [agentsTasksTable.id],
      name: 'agents_task_run_logs_task_id_fk'
    }).onDelete('cascade'),
    index('agents_task_run_logs_task_id_idx').on(t.task_id)
  ]
)

export type AgentsTaskRow = typeof agentsTasksTable.$inferSelect
export type InsertAgentsTaskRow = typeof agentsTasksTable.$inferInsert
export type AgentsTaskRunLogRow = typeof agentsTaskRunLogsTable.$inferSelect
export type InsertAgentsTaskRunLogRow = typeof agentsTaskRunLogsTable.$inferInsert
