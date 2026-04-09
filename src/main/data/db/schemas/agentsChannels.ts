import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsAgentsTable } from './agentsAgents'
import { agentsSessionsTable } from './agentsSessions'
import { agentsTasksTable } from './agentsTasks'

export const agentsChannelsTable = sqliteTable(
  'agents_channels',
  {
    id: text().primaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    agent_id: text().references(() => agentsAgentsTable.id, { onDelete: 'set null' }),
    session_id: text().references(() => agentsSessionsTable.id, { onDelete: 'set null' }),
    config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    is_active: integer({ mode: 'boolean' }).notNull().default(true),
    active_chat_ids: text({ mode: 'json' }).$type<string[]>().default([]),
    permission_mode: text(),
    created_at: integer(),
    updated_at: integer()
  },
  (t) => [
    index('agents_channels_agent_id_idx').on(t.agent_id),
    index('agents_channels_type_idx').on(t.type),
    index('agents_channels_session_id_idx').on(t.session_id),
    check('agents_channels_type_check', sql`${t.type} IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')`),
    check(
      'agents_channels_permission_mode_check',
      sql`${t.permission_mode} IS NULL OR ${t.permission_mode} IN ('default', 'acceptEdits', 'bypassPermissions', 'plan')`
    )
  ]
)

export const agentsChannelTaskSubscriptionsTable = sqliteTable(
  'agents_channel_task_subscriptions',
  {
    channel_id: text()
      .notNull()
      .references(() => agentsChannelsTable.id, { onDelete: 'cascade' }),
    task_id: text()
      .notNull()
      .references(() => agentsTasksTable.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.channel_id, t.task_id] }),
    index('agents_channel_task_subscriptions_channel_id_idx').on(t.channel_id),
    index('agents_channel_task_subscriptions_task_id_idx').on(t.task_id)
  ]
)

export type AgentsChannelRow = typeof agentsChannelsTable.$inferSelect
export type InsertAgentsChannelRow = typeof agentsChannelsTable.$inferInsert
export type AgentsChannelTaskSubscriptionRow = typeof agentsChannelTaskSubscriptionsTable.$inferSelect
export type InsertAgentsChannelTaskSubscriptionRow = typeof agentsChannelTaskSubscriptionsTable.$inferInsert
