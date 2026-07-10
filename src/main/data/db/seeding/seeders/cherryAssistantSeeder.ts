import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { userModelTable } from '@data/db/schemas/userModel'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { count, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { DbOrTx, DbType, ISeeder } from '../../types'

const CHERRY_ASSISTANT_SEED = {
  name: 'Cherry Assistant',
  configuration: {
    avatar: '🍒',
    permission_mode: 'default',
    max_turns: 100,
    env_vars: {},
    builtin_role: 'assistant'
  } satisfies AgentConfiguration
} as const

export class CherryAssistantSeeder implements ISeeder {
  readonly name = 'cherryAssistant'
  readonly description = 'Insert the builtin Cherry Assistant agent for empty agent libraries'
  readonly executionPolicy = 'run-on-change' as const
  // Deliberately manual, despite the seeding guide's checksum default: this seeder is
  // a one-time eligibility check and never updates existing rows. Preset content is
  // resolved from the bundle at runtime; changing this version would let preset edits
  // punch through the journal after users delete all agents and recreate the assistant.
  readonly version = '1'

  run(db: DbType): void {
    db.transaction((tx) => {
      // This seed is a one-time eligibility check. SeedRunner still writes the journal
      // when any library history exists, so users who later delete all agents do not get
      // an automatic recreation. Agent rows include soft-deleted migration history; orphaned
      // sessions are durable history too because deleting an agent sets their agentId to NULL.
      if (this.hasPriorLibraryHistory(tx)) return

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

  private hasPriorLibraryHistory(tx: DbOrTx): boolean {
    const [{ agentCount }] = tx.select({ agentCount: count() }).from(agentTable).all()
    if (agentCount > 0) return true

    const [{ sessionCount }] = tx.select({ sessionCount: count() }).from(agentSessionTable).all()
    return sessionCount > 0
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
