import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import { ensureBuiltinAssistant } from './ensureBuiltinAssistant'

/**
 * Create the isolated system task used by the Cherry Assistant feedback entry.
 *
 * The command owns the complete main-process outcome: restore the protected
 * built-in Agent when needed, then create a fresh session. Renderer callers
 * receive only the standard session they need to open.
 */
export function createBuiltinAssistantFeedbackSession(): AgentSessionEntity {
  const assistant = ensureBuiltinAssistant()
  return agentSessionService.create({
    agentId: assistant.id,
    name: '',
    workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
  })
}
