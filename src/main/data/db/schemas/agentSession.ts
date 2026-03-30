import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { topicTable } from './topic'

/**
 * Agent Session table — running instance of an agent
 *
 * Created from an agent template. Stores a config snapshot at creation time.
 * Decoupled from agent: deleting agent sets agentId to NULL, session survives.
 * Each session owns a topic (CASCADE): deleting session cleans up all messages.
 */
export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),

    // SET NULL: session survives agent deletion
    agentId: text(),
    agentType: text().notNull(),

    // CASCADE: session owns its topic and messages
    topicId: text().notNull(),

    // Config snapshot (copied from agent at creation)
    model: text().notNull(),
    planModel: text(),
    smallModel: text(),
    accessiblePaths: text({ mode: 'json' }).$type<string[]>(),
    instructions: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    mcps: text({ mode: 'json' }).$type<string[]>(),
    allowedTools: text({ mode: 'json' }).$type<string[]>(),
    slashCommands: text({ mode: 'json' }).$type<unknown[]>(),
    configuration: text({ mode: 'json' }).$type<Record<string, unknown>>(),

    // Claude Code SDK session ID (for resume)
    sdkSessionId: text(),

    sortOrder: integer().notNull().default(0),

    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_agent_id_idx').on(t.agentId),
    index('agent_session_topic_id_idx').on(t.topicId),
    index('agent_session_sort_order_idx').on(t.sortOrder),
    foreignKey({
      columns: [t.agentId],
      foreignColumns: [agentTable.id],
      name: 'fk_agent_session_agent'
    }).onDelete('set null'),
    foreignKey({
      columns: [t.topicId],
      foreignColumns: [topicTable.id],
      name: 'fk_agent_session_topic'
    }).onDelete('cascade')
  ]
)

export type AgentSessionInsert = typeof agentSessionTable.$inferInsert
export type AgentSessionSelect = typeof agentSessionTable.$inferSelect
