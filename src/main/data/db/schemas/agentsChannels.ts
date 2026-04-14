import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentsAgentsTable } from './agentsAgents'
import { agentsSessionsTable } from './agentsSessions'
import { agentsTasksTable } from './agentsTasks'

export const agentsChannelsTable = sqliteTable(
  'agents_channels',
  {
    id: uuidPrimaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    agentId: text('agent_id').references(() => agentsAgentsTable.id, { onDelete: 'set null' }),
    sessionId: text('session_id').references(() => agentsSessionsTable.id, { onDelete: 'set null' }),
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    activeChatIds: text('active_chat_ids', { mode: 'json' }).$type<string[]>().default([]),
    permissionMode: text('permission_mode'),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agents_channels_agent_id_idx').on(t.agentId),
    index('agents_channels_type_idx').on(t.type),
    index('agents_channels_session_id_idx').on(t.sessionId),
    check('agents_channels_type_check', sql`${t.type} IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')`),
    check(
      'agents_channels_permission_mode_check',
      sql`${t.permissionMode} IS NULL OR ${t.permissionMode} IN ('default', 'acceptEdits', 'bypassPermissions', 'plan')`
    )
  ]
)

export const agentsChannelTaskSubscriptionsTable = sqliteTable(
  'agents_channel_task_subscriptions',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => agentsChannelsTable.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => agentsTasksTable.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.taskId] }),
    index('agents_channel_task_subscriptions_channel_id_idx').on(t.channelId),
    index('agents_channel_task_subscriptions_task_id_idx').on(t.taskId)
  ]
)

export type AgentsChannelRow = typeof agentsChannelsTable.$inferSelect
export type InsertAgentsChannelRow = typeof agentsChannelsTable.$inferInsert
export type AgentsChannelTaskSubscriptionRow = typeof agentsChannelTaskSubscriptionsTable.$inferSelect
export type InsertAgentsChannelTaskSubscriptionRow = typeof agentsChannelTaskSubscriptionsTable.$inferInsert
