import { agentTable } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { CHERRY_ASSISTANT_SEED } from '@shared/data/presets/cherryAssistant'
import { count, eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { DbOrTx, DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

export class CherryAssistantSeeder implements ISeeder {
  readonly name = 'cherryAssistant'
  readonly description = 'Insert the builtin Cherry Assistant agent for empty agent libraries'
  readonly executionPolicy = 'run-on-change' as const
  readonly version: string

  constructor() {
    this.version = hashObject(CHERRY_ASSISTANT_SEED)
  }

  run(db: DbType): void {
    db.transaction((tx) => {
      // This seed is a one-time eligibility check. SeedRunner still writes the journal
      // when active agents already exist, so users who later delete all agents do not get
      // an automatic recreation. v1 migration runs before the first seed pass and
      // therefore naturally trips this guard.
      if (this.hasActiveAgents(tx)) return

      const agentId = uuidv4()
      const row = agentService.createAgentTx(tx, agentId, {
        id: agentId,
        type: 'claude-code',
        name: CHERRY_ASSISTANT_SEED.name,
        description: '',
        instructions: '',
        model: this.getCherryAiDefaultModelId(tx),
        configuration: { ...CHERRY_ASSISTANT_SEED.configuration }
      })

      if (!row) {
        throw new Error('insert succeeded but select returned no builtin Cherry Assistant row')
      }

      // One seeded session makes the agent visible in the Agents sidebar. This does
      // not self-heal after user deletion: draft-session creation in the renderer is
      // the intentional path back from an agent-picker-only state.
      agentSessionService.createTx(tx, uuidv4(), {
        agentId,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    })
  }

  private hasActiveAgents(tx: DbOrTx): boolean {
    const [{ agentCount }] = tx
      .select({ agentCount: count() })
      .from(agentTable)
      .where(isNull(agentTable.deletedAt))
      .all()
    return agentCount > 0
  }

  private getCherryAiDefaultModelId(tx: DbOrTx): string | null {
    const [model] = tx
      .select({ id: userModelTable.id })
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .limit(1)
      .all()
    return model?.id ?? null
  }
}
