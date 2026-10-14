import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { DbType, ISeeder } from '../../types'

// A seeder is a versioned rollout snapshot, not a live view of the AI package.
// Runtime restoration reads the current package definition in the AI module;
// keeping this seed local avoids either direction crossing the Data/AI boundary.
const CHERRY_ASSISTANT_SEED = {
  name: {
    default: 'Cherry Assistant',
    zh: 'Cherry 小助手'
  },
  configuration: {
    avatar: '🍒',
    permission_mode: 'acceptEdits',
    bootstrap_completed: true,
    builtin_role: 'assistant',
    env_vars: {}
  } satisfies AgentConfiguration
} as const

export class CherryAssistantSeeder implements ISeeder {
  readonly name = 'cherryAssistant'
  readonly description = 'Insert the builtin Cherry Assistant in every agent library'
  readonly executionPolicy = 'run-on-change' as const
  // Version 1 journaled the old "empty library only" eligibility decision. Version 2
  // rolls the assistant out to existing libraries; the persisted builtin identity still
  // prevents recreating a user-deleted assistant or overwriting user choices.
  readonly version = '2'

  run(db: DbType): void {
    db.transaction((tx) => {
      const existing = agentService.findBuiltinAgentByRoleTx(tx, 'assistant', { includeDeleted: true })
      if (existing) return

      const agentId = uuidv4()
      const row = agentService.createAgentTx(tx, agentId, {
        id: agentId,
        type: 'claude-code',
        name: this.getNameForPreferredSystemLanguage(),
        description: '',
        instructions: '',
        // The managed CherryAI model cannot run the agent runtime. Onboarding
        // assigns the user's default model when they choose one.
        model: null,
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

  private getNameForPreferredSystemLanguage(): string {
    try {
      const language = app.getPreferredSystemLanguages()[0]
      return language?.toLowerCase().startsWith('zh')
        ? CHERRY_ASSISTANT_SEED.name.zh
        : CHERRY_ASSISTANT_SEED.name.default
    } catch {
      return CHERRY_ASSISTANT_SEED.name.default
    }
  }
}
