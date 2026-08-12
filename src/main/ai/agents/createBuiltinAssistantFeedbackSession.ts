import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { v4 as uuidv4 } from 'uuid'

import { loadBuiltinAssistantEnsureInput } from './ensureBuiltinAssistant'

/**
 * Create the isolated system task used by the Cherry Assistant feedback entry.
 *
 * The command owns the complete main-process outcome: restore the protected
 * built-in Agent when needed, then create a fresh session. Renderer callers
 * receive only the standard session they need to open.
 */
export function createBuiltinAssistantFeedbackSession(): AgentSessionEntity {
  const assistantInput = loadBuiltinAssistantEnsureInput()
  const sessionId = uuidv4()
  const ensured = application.get('DbService').withWriteTx((tx) => {
    const result = agentService.ensureBuiltinAgentTx(tx, assistantInput)
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
  return agentSessionService.getById(sessionId)
}
