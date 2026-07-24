import { agentTable } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { DbOrTx, DbType, ISeeder } from '../../types'

const CHERRY_ASSISTANT_SEED = {
  name: 'Cherry Assistant',
  configuration: {
    avatar: '🍒',
    permission_mode: 'acceptEdits',
    max_turns: 100,
    env_vars: {},
    builtin_role: 'assistant'
  } satisfies AgentConfiguration
} as const

export class CherryAssistantSeeder implements ISeeder {
  readonly name = 'cherryAssistant'
  readonly description = 'Insert and update the builtin Cherry Assistant in every agent library'
  readonly executionPolicy = 'run-on-change' as const
  // Deliberately manual: preset content resolves from the bundle at runtime, so only
  // rollout-policy changes should advance this version. v2 includes existing libraries;
  // v3 upgrades the original normal-mode default to auto-edit mode.
  readonly version = '3'

  run(db: DbType): void {
    db.transaction((tx) => {
      const existing = this.findBuiltinAssistant(tx)
      if (existing) {
        // Migrate only the seeded v2 default. Preserve explicit user choices and deletion memory.
        if (existing.deletedAt === null && existing.configuration.permission_mode === 'default') {
          agentService.updateAgentTx(tx, existing.id, {
            configuration: { ...existing.configuration, permission_mode: 'acceptEdits' },
            updatedAt: Date.now()
          })
        }
        return
      }

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

  private findBuiltinAssistant(tx: DbOrTx) {
    const [existing] = tx
      .select({ id: agentTable.id, configuration: agentTable.configuration, deletedAt: agentTable.deletedAt })
      .from(agentTable)
      .where(sql`json_extract(${agentTable.configuration}, '$.builtin_role') = 'assistant'`)
      .limit(1)
      .all()
    return existing
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
