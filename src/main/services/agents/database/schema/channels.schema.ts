/**
 * Drizzle ORM schema for channels and channel_task_subscriptions tables
 */

import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { v4 as uuidv4 } from 'uuid'

import { agentsTable } from './agents.schema'
import {
  type ChannelConfig,
  ChannelConfigSchema,
  type DiscordChannelConfig,
  type FeishuChannelConfig,
  type FeishuDomain,
  type QQChannelConfig,
  type SlackChannelConfig,
  type TelegramChannelConfig,
  type WeChatChannelConfig
} from './channelConfig'
import { sessionsTable } from './sessions.schema'
import { scheduledTasksTable } from './tasks.schema'

export type {
  ChannelConfig,
  DiscordChannelConfig,
  FeishuChannelConfig,
  FeishuDomain,
  QQChannelConfig,
  SlackChannelConfig,
  TelegramChannelConfig,
  WeChatChannelConfig
}
export { ChannelConfigSchema }

// ---- Channels table ----

export const channelsTable = sqliteTable(
  'channels',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv4()),
    type: text('type').notNull(),
    name: text('name').notNull(),
    agentId: text('agent_id').references(() => agentsTable.id, { onDelete: 'set null' }),
    sessionId: text('session_id').references(() => sessionsTable.id, { onDelete: 'set null' }),
    config: text('config', { mode: 'json' }).$type<ChannelConfig>().notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    activeChatIds: text('active_chat_ids', { mode: 'json' }).$type<string[]>().default([]),
    permissionMode: text('permission_mode'),
    createdAt: integer('created_at').$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at')
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [
    index('channels_agent_id_idx').on(t.agentId),
    index('channels_type_idx').on(t.type),
    index('channels_session_id_idx').on(t.sessionId),
    check('channels_type_check', sql`${t.type} IN ('telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack')`),
    check(
      'channels_permission_mode_check',
      sql`${t.permissionMode} IS NULL OR ${t.permissionMode} IN ('default', 'acceptEdits', 'bypassPermissions', 'plan')`
    )
  ]
)

// ---- Channel ↔ Task subscriptions (many-to-many) ----

export const channelTaskSubscriptionsTable = sqliteTable(
  'channel_task_subscriptions',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channelsTable.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => scheduledTasksTable.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.taskId] }),
    index('cts_channel_id_idx').on(t.channelId),
    index('cts_task_id_idx').on(t.taskId)
  ]
)

// ---- Type exports ----

export type ChannelRow = typeof channelsTable.$inferSelect
export type InsertChannelRow = typeof channelsTable.$inferInsert
export type ChannelTaskSubscriptionRow = typeof channelTaskSubscriptionsTable.$inferSelect
export type InsertChannelTaskSubscriptionRow = typeof channelTaskSubscriptionsTable.$inferInsert
