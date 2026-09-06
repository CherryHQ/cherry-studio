import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
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
  const caps = AGENT_RUNTIME_CAPABILITIES[values.agentType]
  const permissionMode = caps.permissionModes.some((mode) => mode === values.permissionMode)
    ? values.permissionMode
    : caps.createDefaults.permissionMode
  return {
    type: values.agentType,
    name: values.name,
    model: values.modelId,
    ...(caps.modelTiers ? { planModel: values.modelId, smallModel: values.modelId } : {}),
    description: values.description,
    instructions: values.prompt,
    ...(caps.knowledgeBases ? { knowledgeBaseIds: values.knowledgeBaseIds } : {}),
    ...(caps.skills ? { skillIds: values.skillIds } : {}),
    configuration: {
      avatar: values.avatar,
      permission_mode: permissionMode,
      ...(values.defaultWorkspaceId ? { default_workspace_id: values.defaultWorkspaceId } : {})
    }
  }
}
