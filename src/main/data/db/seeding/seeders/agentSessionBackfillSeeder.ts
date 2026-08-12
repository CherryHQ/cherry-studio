import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionService } from '@data/services/AgentSessionService'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { and, eq, isNull, notExists } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { DbType, ISeeder } from '../../types'

/**
 * Give every session-less agent a session so it is reachable again.
 *
 * The default sidebar derives its rows from sessions, so an agent with none is
 * invisible there and cannot be opened. Agents created through the tool/MCP/API
 * path used to land in exactly that state; creation now seeds the first session,
 * but libraries written before that fix still hold the stranded rows.
 *
 * Runs once (seed journal). Deliberately not a permanent self-heal: deleting the
 * last session of an agent stays a user decision.
 */
export class AgentSessionBackfillSeeder implements ISeeder {
  readonly name = 'agentSessionBackfill'
  readonly description = 'Give agents stranded without any session a system session'
  readonly version = '1'

  run(db: DbType): void {
    db.transaction((tx) => {
      const stranded = tx
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          and(
            isNull(agentTable.deletedAt),
            notExists(
              tx
                .select({ id: agentSessionTable.id })
                .from(agentSessionTable)
                .where(eq(agentSessionTable.agentId, agentTable.id))
            )
          )
        )
        .all()

      for (const agent of stranded) {
        agentSessionService.createTx(tx, uuidv4(), {
          agentId: agent.id,
          name: '',
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        })
      }
    })
  }
}
