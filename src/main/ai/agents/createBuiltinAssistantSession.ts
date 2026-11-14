import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

import { loadBuiltinAgentEnsureInput } from './ensureBuiltinAgent'

/** Restore Cherry Assistant when needed and create a fresh session in `workspace` atomically. */
export function createBuiltinAssistantSession(
  workspace: AgentSessionWorkspaceSource = { type: AGENT_WORKSPACE_TYPE.SYSTEM }
): AgentSessionEntity {
  const assistantInput = loadBuiltinAgentEnsureInput(BUILTIN_AGENT_ROLE.ASSISTANT)
  const sessionId = uuidv4()
  const ensured = application.get('DbService').withWriteTx((tx) => {
    const result = agentService.ensureBuiltinAgentTx(tx, assistantInput)
    agentSessionService.createTx(tx, sessionId, {
      agentId: result.agent.id,
      name: '',
      workspace
    })
    return result
  })

  if (ensured.created || ensured.restored) {
    agentService.emitAgentCreated(ensured.agent)
  }
  agentSessionService.notifyReadModelChange([sessionId], 'membership')
  return agentSessionService.getById(sessionId)
}
