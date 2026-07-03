import type { AgentSessionContextUsageSnapshot } from '@shared/ai/agentSessionContextUsage'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentWorkspaceTable } from './agentWorkspace'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    name: text().notNull(),
    // Whether the name was manually edited by user.
    isNameManuallyEdited: integer({ mode: 'boolean' }).notNull().default(false),
    description: text().notNull().default(''),
    workspaceId: text()
      .notNull()
      .references(() => agentWorkspaceTable.id, { onDelete: 'cascade' }),
    traceId: text(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [orderKeyIndex('agent_session')(t), index('agent_session_updated_at_idx').on(t.updatedAt)]
)

export type AgentSessionRow = typeof agentSessionTable.$inferSelect
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert

// Per-session derived/ephemeral runtime state, kept in a 1:1 side table rather than on
// `agent_session`. The point of the split is isolation: these columns are written at high
// frequency (e.g. context-usage refreshes stream during a turn), and writing them on the
// session row would auto-bump `agent_session.updatedAt` (`$onUpdateFn`), churning the session's
// recency ordering. Future per-session derived state joins here as a new nullable column — not a
// new single-field table, and never an EAV key/value blob.
export const agentSessionStateTable = sqliteTable('agent_session_state', {
  sessionId: text()
    .primaryKey()
    .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
  // Latest context-usage snapshot. Nullable: a state row may exist for other per-session state
  // before/without a usage snapshot.
  lastContextUsage: text({ mode: 'json' }).$type<AgentSessionContextUsageSnapshot>(),
  ...createUpdateTimestamps
})

export type AgentSessionStateRow = typeof agentSessionStateTable.$inferSelect
export type InsertAgentSessionStateRow = typeof agentSessionStateTable.$inferInsert
