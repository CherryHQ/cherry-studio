import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentSessionTable } from './agentSession'
import { agentTaskTable } from './agentTask'

export const agentChannelTable = sqliteTable(
  'agent_channel',
  {
    id: uuidPrimaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    sessionId: text().references(() => agentSessionTable.id, { onDelete: 'set null' }),
    config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    isActive: integer({ mode: 'boolean' }).notNull().default(true),
    activeChatIds: text({ mode: 'json' }).$type<string[]>().default([]),
    permissionMode: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_channel_agent_id_idx').on(t.agentId),
    index('agent_channel_type_idx').on(t.type),
    index('agent_channel_session_id_idx').on(t.sessionId),
    check('agent_channel_type_check', sql`${t.type} IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')`),
    check(
      'agent_channel_permission_mode_check',
      sql`${t.permissionMode} IS NULL OR ${t.permissionMode} IN ('default', 'acceptEdits', 'bypassPermissions', 'plan')`
    )
  ]
)

export const agentChannelTaskTable = sqliteTable(
  'agent_channel_task',
  {
    channelId: text()
      .notNull()
      .references(() => agentChannelTable.id, { onDelete: 'cascade' }),
    taskId: text()
      .notNull()
      .references(() => agentTaskTable.id, { onDelete: 'cascade' })
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
