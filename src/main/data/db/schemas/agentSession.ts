import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentWorkspaceTable } from './agentWorkspace'
import { jobScheduleTable } from './job'
import { userModelTable } from './userModel'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),
    ownerSessionId: text().references((): AnySQLiteColumn => agentSessionTable.id, { onDelete: 'cascade' }),
    type: text({ enum: ['conversation', 'background'] })
      .notNull()
      .default('conversation'),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    /** Per-session model override; null follows the parent agent's model. */
    model: text().references(() => userModelTable.id, { onDelete: 'set null' }),
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
