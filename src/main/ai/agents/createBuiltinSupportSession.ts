import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { v4 as uuidv4 } from 'uuid'

import { loadBuiltinAgentEnsureInput } from './ensureBuiltinAgent'

/** Restore Cherry Support when needed and create a fresh system session atomically. */
export function createBuiltinSupportSession(): AgentSessionEntity {
  const supportInput = loadBuiltinAgentEnsureInput(BUILTIN_AGENT_ROLE.SUPPORT)
  const sessionId = uuidv4()
  const ensured = application.get('DbService').withWriteTx((tx) => {
    const result = agentService.ensureBuiltinAgentTx(tx, supportInput)
    agentSessionService.createTx(tx, sessionId, {
      agentId: result.agent.id,
      name: '',
      workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
    })
    return result
  })

  if (ensured.created) {
    agentService.emitAgentCreated(ensured.agent)
  }
  agentSessionService.notifyReadModelChange([sessionId], 'membership')
  return agentSessionService.getById(sessionId)
}
