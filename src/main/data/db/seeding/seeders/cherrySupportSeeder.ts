import { v4 as uuidv4 } from 'uuid'

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { DbType, ISeeder } from '../../types'
import { loadBuiltinAgentSeedDefaults } from '../builtinAgentSeedDefaults'

export class CherrySupportSeeder implements ISeeder {
  readonly name = 'cherrySupport'
  readonly description = 'Insert the builtin Cherry Support agent in every agent library'
  readonly executionPolicy = 'run-on-change' as const
  readonly version = '3'

  run(db: DbType): void {
    db.transaction((tx) => {
      const builtinRole = BUILTIN_AGENT_ROLE.SUPPORT
      agentService.clearUntrustedBuiltinSupportRolesTx(tx)
      agentService.claimBuiltinSupportIdentityTx(tx)
      const existing = agentService.findBuiltinAgentByRoleTx(tx, builtinRole, {
        includeDeleted: true
      })
      if (existing) {
        if (existing.name === 'Cherry 支持') {
          agentService.updateAgentTx(tx, existing.id, { name: loadBuiltinAgentSeedDefaults(builtinRole, 'zh-CN').name })
        }
        return
      }

      const assistant = agentService.findBuiltinAgentByRoleTx(tx, BUILTIN_AGENT_ROLE.ASSISTANT)
      const { agent } = agentService.createBuiltinAgentTx(
        tx,
        { ...loadBuiltinAgentSeedDefaults(builtinRole), builtinRole },
        assistant?.model ?? null
      )

      agentSessionService.createTx(tx, uuidv4(), {
        agentId: agent.id,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    })
  }
}
