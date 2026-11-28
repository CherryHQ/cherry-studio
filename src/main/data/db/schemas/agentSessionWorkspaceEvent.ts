import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { uuidPrimaryKey } from './_columnHelpers'
import { agentSessionTable } from './agentSession'

/**
 * Deliberate workspace rebinds recorded on a session (spec:
 * `.agents/notes/proposed/feature/2026-11-28-agent-session-workdir-rebind.md`).
 * A runtime resume path compares the observed cwd identity against this log:
 * a deliberate rebind has a matching event, while an unexpected change does
 * not and must keep failing closed. Rows are append-only evidence; they are
 * never rewritten when the workspace changes again.
 */
export const agentSessionWorkspaceEventTable = sqliteTable(
  'agent_session_workspace_event',
  {
    id: uuidPrimaryKey(),
    sessionId: text()
      .notNull()
      .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
    previousWorkspaceId: text().notNull(),
    previousWorkspacePath: text().notNull(),
    newWorkspaceId: text().notNull(),
    newWorkspacePath: text().notNull(),
    createdAt: integer().notNull().$defaultFn(Date.now),
    /**
     * Set once the rebind has been surfaced to the model in a submitted turn
     * (see prepareNativeSubmission); NULL while the note is still pending.
     */
    surfacedAt: integer()
  },
  (t) => [index('agent_session_workspace_event_session_idx').on(t.sessionId, t.createdAt)]
)

export type AgentSessionWorkspaceEventRow = typeof agentSessionWorkspaceEventTable.$inferSelect
export type InsertAgentSessionWorkspaceEventRow = typeof agentSessionWorkspaceEventTable.$inferInsert
