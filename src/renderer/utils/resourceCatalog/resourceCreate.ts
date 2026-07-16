import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { CreateAgentDto } from '@shared/data/api/schemas/agents'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { AgentType } from '@shared/data/types/agent'

/** Map the shared create-wizard values to the Assistant DataApi contract. */
export function buildCreateAssistantDto(values: ResourceCreateValues): CreateAssistantDto {
  return {
    name: values.name,
    emoji: values.avatar,
    modelId: values.modelId,
    description: values.description,
    prompt: values.prompt,
    knowledgeBaseIds: values.knowledgeBaseIds
  }
}

/** Map the shared create-wizard values to the Agent DataApi contract. */
export function buildCreateAgentDto(values: ResourceCreateValues, agentType: AgentType): CreateAgentDto {
  const caps = AGENT_RUNTIME_CAPABILITIES[agentType]
  const base: CreateAgentDto = {
    type: agentType,
    name: values.name,
    model: values.modelId,
    description: values.description,
    instructions: values.prompt,
    configuration: {
      avatar: values.avatar,
      permission_mode: caps.createDefaults.permissionMode
    }
  }

  return {
    ...base,
    ...(caps.skills ? { skillIds: values.skillIds } : {}),
    ...(caps.modelTiers ? { planModel: values.modelId, smallModel: values.modelId } : {})
  }
}
