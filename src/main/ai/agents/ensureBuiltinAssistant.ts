import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

import { loadBuiltinAssistantDefaults } from './builtin/builtinAgentDefinition'

export function loadBuiltinAssistantEnsureInput(): Parameters<typeof agentService.ensureBuiltinAgent>[0] {
  const defaults = loadBuiltinAssistantDefaults()
  const defaultModelId = (application.get('PreferenceService').get('chat.default_model_id') ??
    null) as UniqueModelId | null
  return {
    ...defaults,
    builtinRole: 'assistant',
    preferredModelId: defaultModelId,
    type: 'claude-code'
  }
}

export function ensureBuiltinAssistant(): AgentEntity {
  return agentService.ensureBuiltinAgent(loadBuiltinAssistantEnsureInput())
}
