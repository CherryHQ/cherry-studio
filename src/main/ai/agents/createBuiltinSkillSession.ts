import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { v4 as uuidv4 } from 'uuid'

import { loadBuiltinAgentEnsureInput } from './ensureBuiltinAgent'

/** Restore Cherry Assistant, bind one enabled Skill, and create a fresh system session atomically. */
export function createBuiltinSkillSession(skillId: string): AgentSessionEntity {
  const assistantInput = loadBuiltinAgentEnsureInput(BUILTIN_AGENT_ROLE.ASSISTANT)
  const sessionId = uuidv4()
  const ensured = application.get('DbService').withWriteTx((tx) => {
    const skill = agentGlobalSkillService.getByIdTx(tx, skillId)
    if (!skill) throw DataApiErrorFactory.notFound('Skill', skillId)
    if (!skill.isGlobalEnabled) {
      throw DataApiErrorFactory.invalidOperation('create skill session', 'the skill is globally disabled')
    }

    const result = agentService.ensureBuiltinAgentTx(tx, assistantInput)
    agentGlobalSkillService.upsertJoinTx(tx, result.agent.id, skillId, true)
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
  agentGlobalSkillService.notifyAgentSkillChange(skillId)
  agentSessionService.notifyReadModelChange([sessionId], 'membership')
  return agentSessionService.getById(sessionId)
}
