/**
 * Drizzle ORM schema for scheduled tasks tables
 */

import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsTable } from './agents.schema'

export const scheduledTasksTable = sqliteTable('scheduled_tasks', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  schedule_type: text('schedule_type').notNull(), // 'cron' | 'interval' | 'once'
  schedule_value: text('schedule_value').notNull(), // cron expression, milliseconds as string, or ISO timestamp
  context_mode: text('context_mode').notNull().default('session'), // 'session' | 'isolated'
  next_run: text('next_run'),
  last_run: text('last_run'),
  last_result: text('last_result'),
  status: text('status').notNull().default('active'), // 'active' | 'paused' | 'completed'
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

export const taskRunLogsTable = sqliteTable('task_run_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  task_id: text('task_id').notNull(),
  run_at: text('run_at').notNull(),
  duration_ms: integer('duration_ms').notNull(),
  status: text('status').notNull(), // 'success' | 'error'
  result: text('result'),
  error: text('error')
})

// Foreign keys
export const scheduledTasksFkAgent = foreignKey({
  columns: [scheduledTasksTable.agent_id],
  foreignColumns: [agentsTable.id],
  name: 'fk_scheduled_tasks_agent_id'
}).onDelete('cascade')

export const taskRunLogsFkTask = foreignKey({
  columns: [taskRunLogsTable.task_id],
  foreignColumns: [scheduledTasksTable.id],
  name: 'fk_task_run_logs_task_id'
}).onDelete('cascade')

// Indexes for scheduled_tasks table
export const tasksAgentIdIdx = index('idx_tasks_agent_id').on(scheduledTasksTable.agent_id)
export const tasksNextRunIdx = index('idx_tasks_next_run').on(scheduledTasksTable.next_run)
export const tasksStatusIdx = index('idx_tasks_status').on(scheduledTasksTable.status)

// Indexes for task_run_logs table
export const taskRunLogsTaskIdIdx = index('idx_task_run_logs_task_id').on(taskRunLogsTable.task_id)

// Type exports
export type TaskRow = typeof scheduledTasksTable.$inferSelect
export type InsertTaskRow = typeof scheduledTasksTable.$inferInsert
export type TaskRunLogRow = typeof taskRunLogsTable.$inferSelect
export type InsertTaskRunLogRow = typeof taskRunLogsTable.$inferInsert
