import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { ChannelType } from '@shared/data/types/channel'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentSessionTable } from './agentSession'
import { jobScheduleTable } from './job'

/**
 * `type` and `permissionMode` are enums, but deliberately carry no CHECK constraint:
 * a SQL copy of an enum makes every added member a table recreate, and the copies drift
 * the moment one is added in a hurry. Both are `$type`-narrowed here for internal callers
 * and validated by their zod schemas at the DataApi boundary.
 */
export const agentChannelTable = sqliteTable(
  'agent_channel',
  {
    id: uuidPrimaryKey(),
    type: text().$type<ChannelType>().notNull(),
    name: text().notNull(),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    sessionId: text().references(() => agentSessionTable.id, { onDelete: 'set null' }),
    workspace: text({ mode: 'json' }).$type<AgentSessionWorkspaceSource>().notNull(),
    config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    isActive: integer({ mode: 'boolean' }).notNull().default(true),
    activeChatIds: text({ mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    permissionMode: text().$type<AgentPermissionMode | null>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_channel_agent_id_idx').on(t.agentId),
    index('agent_channel_type_idx').on(t.type),
    index('agent_channel_session_id_idx').on(t.sessionId)
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
