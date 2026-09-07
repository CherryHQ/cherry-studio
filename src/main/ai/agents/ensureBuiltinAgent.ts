import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import type { BuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

import { loadBuiltinAgentDefaults } from './builtin/builtinAgentDefinition'

export function loadBuiltinAgentEnsureInput(
  builtinRole: BuiltinAgentRole
): Parameters<typeof agentService.ensureBuiltinAgent>[0] {
  const defaults = loadBuiltinAgentDefaults(builtinRole)
  const defaultModelId = (application.get('PreferenceService').get('chat.default_model_id') ??
    null) as UniqueModelId | null
  return {
    ...defaults,
    builtinRole,
    preferredModelId: defaultModelId,
    type: 'claude-code'
  }
}

export function ensureBuiltinAgent(builtinRole: BuiltinAgentRole): AgentEntity {
  return agentService.ensureBuiltinAgent(loadBuiltinAgentEnsureInput(builtinRole))
}
