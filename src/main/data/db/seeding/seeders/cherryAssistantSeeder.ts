import { v4 as uuidv4 } from 'uuid'

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { DbType, ISeeder } from '../../types'
import { loadBuiltinAgentSeedDefaults } from '../builtinAgentSeedDefaults'

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
      const builtinRole = BUILTIN_AGENT_ROLE.ASSISTANT
      const existing = agentService.findBuiltinAgentByRoleTx(tx, builtinRole, { includeDeleted: true })
      if (existing) return

      // Onboarding assigns a compatible model after the user chooses one.
      const { agent } = agentService.createBuiltinAgentTx(
        tx,
        { ...loadBuiltinAgentSeedDefaults(builtinRole), builtinRole },
        null
      )

      // One seeded session makes the agent visible in the Agents sidebar. This does
      // not self-heal after user deletion: draft-session creation in the renderer is
      // the intentional path back from an agent-picker-only state.
      agentSessionService.createTx(tx, uuidv4(), {
        agentId: agent.id,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    })
  }
}
