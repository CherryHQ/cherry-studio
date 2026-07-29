import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentSessionTable } from './agentSession'
import { jobScheduleTable } from './job'

export const agentChannelTable = sqliteTable(
  'agent_channel',
  {
    id: uuidPrimaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    sessionId: text().references(() => agentSessionTable.id, { onDelete: 'set null' }),
    workspace: text({ mode: 'json' }).$type<AgentSessionWorkspaceSource>().notNull(),
    config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    isActive: integer({ mode: 'boolean' }).notNull().default(true),
    activeChatIds: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    // Values are constrained by `AgentPermissionModeSchema` at the DataApi boundary and by
    // `AgentChannelService`'s parameter types internally. Deliberately no CHECK constraint:
    // duplicating the enum in SQL made every new mode a table recreate, and the two copies
    // drifted the first time the SDK gained one.
    permissionMode: text().$type<AgentPermissionMode | null>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_channel_agent_id_idx').on(t.agentId),
    index('agent_channel_type_idx').on(t.type),
    index('agent_channel_session_id_idx').on(t.sessionId),
    check('agent_channel_type_check', sql`${t.type} IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')`)
  ]
)

export const agentChannelTaskTable = sqliteTable(
  'agent_channel_task',
  {
    channelId: text()
      .notNull()
      .references(() => agentChannelTable.id, { onDelete: 'cascade' }),
    // FK target switched to jobScheduleTable as part of the agent.task → JobManager
    // migration. Column name stays `task_id` to keep the renderer / channel API
    // field access unchanged (the value semantically is the schedule id now).
    taskId: text()
      .notNull()
      .references(() => jobScheduleTable.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.taskId] }),
    index('agent_channel_task_channel_id_idx').on(t.channelId),
    index('agent_channel_task_task_id_idx').on(t.taskId)
  ]
)

export type AgentChannelRow = typeof agentChannelTable.$inferSelect
export type InsertAgentChannelRow = typeof agentChannelTable.$inferInsert
export type AgentChannelTaskRow = typeof agentChannelTaskTable.$inferSelect
export type InsertAgentChannelTaskRow = typeof agentChannelTaskTable.$inferInsert
