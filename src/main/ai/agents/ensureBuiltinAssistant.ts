import { application } from '@application'
import { loadBuiltinAssistantDefaults } from '@data/builtinAgentDefinition'
import { agentService } from '@data/services/AgentService'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

export function ensureBuiltinAssistant(): AgentEntity {
  const defaults = loadBuiltinAssistantDefaults()
  const defaultModelId = (application.get('PreferenceService').get('chat.default_model_id') ??
    null) as UniqueModelId | null
  return agentService.ensureBuiltinAssistant({
    ...defaults,
    defaultModelId
  })
}
