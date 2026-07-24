import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import type { CreateAgentDto } from '@shared/data/api/schemas/agents'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'

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
export function buildCreateAgentDto(values: ResourceCreateValues): CreateAgentDto {
  return {
    type: 'claude-code',
    name: values.name,
    model: values.modelId,
    planModel: values.modelId,
    smallModel: values.modelId,
    description: values.description,
    instructions: values.prompt,
    knowledgeBaseIds: values.knowledgeBaseIds,
    skillIds: values.skillIds,
    configuration: {
      avatar: values.avatar,
      permission_mode: 'bypassPermissions'
    }
  }
}
