import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loadBuiltinAgentDefinition } from '@main/ai/agents/builtin/BuiltinAgentProvisioner'
import { type AgentEntity, sanitizeAgentConfiguration } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

export function ensureBuiltinAssistant(): AgentEntity {
  const definition = loadBuiltinAgentDefinition('assistant')
  if (!definition) {
    throw new Error('Cherry Assistant package definition is unavailable')
  }

  const { data: configuration, invalidKeys } = sanitizeAgentConfiguration(definition.configuration)
  if (!configuration || invalidKeys.length > 0) {
    throw new Error(`Cherry Assistant package configuration is invalid: ${invalidKeys.join(', ') || '<root>'}`)
  }

  const defaultModelId = (application.get('PreferenceService').get('chat.default_model_id') ??
    null) as UniqueModelId | null
  return agentService.ensureBuiltinAssistant({
    name: definition.name ?? 'Cherry Assistant',
    configuration,
    defaultModelId
  })
}
