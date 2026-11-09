import { agentSessionMessageTable, type InsertAgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'
import {
  type AgentSessionMessageData,
  replaceAgentSessionMessagePartsTx,
  splitAgentSessionMessageData
} from '@data/services/agentSessionMessageTree'

export type AgentSessionMessageFixture = Omit<InsertAgentSessionMessageRow, 'data'> & { data: AgentSessionMessageData }

/**
 * Seeds agent-session messages the way production stores them: the container row plus its ordered
 * `agent_session_message_part` rows, with `searchable_text` derived from the parts.
 */
export function insertAgentSessionMessages(
  db: DbOrTx,
  fixtures: AgentSessionMessageFixture | readonly AgentSessionMessageFixture[]
): void {
  for (const fixture of Array.isArray(fixtures) ? fixtures : [fixtures]) {
    const { data, parts } = splitAgentSessionMessageData(fixture.data)
    const inserted = db
      .insert(agentSessionMessageTable)
      .values({ ...fixture, data })
      .returning({ id: agentSessionMessageTable.id, updatedAt: agentSessionMessageTable.updatedAt })
      .get()
    replaceAgentSessionMessagePartsTx(db, {
      sessionId: fixture.sessionId,
      messageId: inserted.id,
      parts,
      timestampMs: inserted.updatedAt
    })
  }
}
