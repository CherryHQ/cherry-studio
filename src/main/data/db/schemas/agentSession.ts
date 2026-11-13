import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentWorkspaceTable } from './agentWorkspace'
import { jobScheduleTable } from './job'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),
    ownerSessionId: text().references((): AnySQLiteColumn => agentSessionTable.id, { onDelete: 'cascade' }),
    type: text({ enum: ['conversation', 'background'] })
      .notNull()
      .default('conversation'),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    name: text().notNull(),
    // Whether the name was manually edited by user.
    isNameManuallyEdited: integer({ mode: 'boolean' }).notNull().default(false),
    description: text().notNull().default(''),
    workspaceId: text()
      .notNull()
      .references(() => agentWorkspaceTable.id, { onDelete: 'cascade' }),
    // Task ownership survives reuse changes and execution-log collection.
    taskId: text().references(() => jobScheduleTable.id, { onDelete: 'set null' }),
    isTaskReuseTarget: integer({ mode: 'boolean' }).notNull().default(false),
    // 2.1.10 compatibility projection of the reusable binding; taskId owns sessions.
    // Database triggers synchronize legacy writes; current code uses canonical fields.
    taskScheduleId: text().unique(),
    traceId: text(),
    activeNodeId: text(),
    ...orderKeyColumns,
    // Dedicated conversation activity time. Name, owner, workspace and order
    // changes must not move this column.
    lastActivityAt: integer().notNull().$defaultFn(Date.now),
    ...createUpdateDeleteTimestamps
  },
  (t) => [
    orderKeyIndex('agent_session')(t),
    index('agent_session_task_idx').on(t.taskId),
    uniqueIndex('agent_session_task_reuse_uq')
      .on(t.taskId)
      .where(sql`${t.isTaskReuseTarget} = 1`),
    check('agent_session_task_reuse_owner_check', sql`${t.isTaskReuseTarget} = 0 OR ${t.taskId} IS NOT NULL`),
    index('agent_session_owner_idx').on(t.ownerSessionId),
    index('agent_session_last_activity_at_idx').on(t.lastActivityAt),
    index('agent_session_updated_at_idx').on(t.updatedAt)
  ]
)

export type AgentSessionRow = typeof agentSessionTable.$inferSelect
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert
export type AgentSessionType = AgentSessionRow['type']

export const AGENT_SESSION_DOWNGRADE_COMPATIBILITY_STATEMENTS: string[] = [
  'DROP TRIGGER IF EXISTS agent_session_compat_insert',
  `CREATE TRIGGER agent_session_compat_insert AFTER INSERT ON agent_session
  WHEN NEW.task_schedule_id IS NOT (CASE WHEN NEW.is_task_reuse_target = 1 THEN NEW.task_id ELSE NULL END)
    OR (NEW.task_schedule_id IS NOT NULL AND NEW.task_id IS NULL)
  BEGIN
    UPDATE agent_session SET
      task_id = coalesce(NEW.task_schedule_id, NEW.task_id),
      is_task_reuse_target = CASE WHEN NEW.task_schedule_id IS NOT NULL THEN 1 ELSE NEW.is_task_reuse_target END,
      task_schedule_id = coalesce(NEW.task_schedule_id, CASE WHEN NEW.is_task_reuse_target = 1 THEN NEW.task_id ELSE NULL END)
    WHERE id = NEW.id;
  END`,
  'DROP TRIGGER IF EXISTS agent_session_compat_canonical',
  `CREATE TRIGGER agent_session_compat_canonical AFTER UPDATE OF task_id, is_task_reuse_target ON agent_session
  WHEN NEW.task_schedule_id IS NOT (CASE WHEN NEW.is_task_reuse_target = 1 THEN NEW.task_id ELSE NULL END)
  BEGIN
    UPDATE agent_session SET task_schedule_id = CASE WHEN NEW.is_task_reuse_target = 1 THEN NEW.task_id ELSE NULL END
    WHERE id = NEW.id;
  END`,
  'DROP TRIGGER IF EXISTS agent_session_compat_legacy',
  `CREATE TRIGGER agent_session_compat_legacy AFTER UPDATE OF task_schedule_id ON agent_session
  WHEN NEW.task_schedule_id IS NOT (CASE WHEN NEW.is_task_reuse_target = 1 THEN NEW.task_id ELSE NULL END)
  BEGIN
    UPDATE agent_session SET task_id = coalesce(NEW.task_schedule_id, NEW.task_id),
      is_task_reuse_target = NEW.task_schedule_id IS NOT NULL
    WHERE id = NEW.id;
  END`,
  'DROP TRIGGER IF EXISTS job_schedule_compat_delete',
  `CREATE TRIGGER job_schedule_compat_delete BEFORE DELETE ON job_schedule
  BEGIN
    UPDATE agent_session SET is_task_reuse_target = 0 WHERE task_id = OLD.id AND is_task_reuse_target IS 1;
  END`
]
