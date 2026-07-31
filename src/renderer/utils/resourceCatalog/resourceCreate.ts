import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

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
export function buildCreateAgentCommand(values: ResourceCreateValues): CreateAgentCommand {
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
      // A new agent asks about risky actions rather than running everything unattended.
      // `bypassPermissions` stays available, but opting out of approvals is the user's call.
      permission_mode: 'auto'
    }
  }
}
