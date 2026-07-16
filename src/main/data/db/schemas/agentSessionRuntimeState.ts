import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentSessionTable } from './agentSession'
import { agentSessionMessageTable } from './agentSessionMessage'

/**
 * Durable per-session runtime state for Cherry-managed agent runtimes —
 * currently the AI SDK runtime's compaction checkpoint. Internal business
 * state: no DataApi resource, owned by `AgentSessionRuntimeStateService`.
 *
 * One row per session (PK = session_id); `runtime_type` discriminates the
 * writer so a reader never consumes state produced by another runtime.
 */
export const agentSessionRuntimeStateTable = sqliteTable('agent_session_runtime_state', {
  sessionId: text()
    .primaryKey()
    .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
  runtimeType: text().notNull(),
  // Payload schema version — readers treat an unknown version as absent state.
  version: integer().notNull(),
  // Last message covered by `summary`. The FK is defense-in-depth: service-level
  // invalidation already clears state on any message delete in the same tx.
  compactedThroughMessageId: text()
    .notNull()
    .references(() => agentSessionMessageTable.id, { onDelete: 'cascade' }),
  summary: text().notNull(),
  summaryTokenCount: integer(),
  sourceTokenCount: integer(),
  compactionModelId: text().notNull(),
  ...createUpdateTimestamps
})

export type AgentSessionRuntimeStateRow = typeof agentSessionRuntimeStateTable.$inferSelect
export type InsertAgentSessionRuntimeStateRow = typeof agentSessionRuntimeStateTable.$inferInsert
