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

/** Map the shared create-wizard values to the Agent creation command. */
export function buildCreateAgentCommand(values: ResourceCreateValues): CreateAgentCommand {
  const caps = AGENT_RUNTIME_CAPABILITIES[values.agentType]
  const permissionMode = caps.permissionModes.some((mode) => mode === values.permissionMode)
    ? values.permissionMode
    : caps.createDefaults.permissionMode
  const identity: Omit<CreateAgentCommand, 'name' | 'model'> = { type: values.agentType }
  if (values.avatarImage) identity.avatarImage = values.avatarImage
  const command: CreateAgentCommand = Object.assign(identity, { name: values.name, model: values.modelId })
  if (caps.modelTiers) {
    command.planModel = values.modelId
    command.smallModel = values.modelId
  }
  command.description = values.description
  command.instructions = values.prompt
  if (caps.knowledgeBases) command.knowledgeBaseIds = values.knowledgeBaseIds
  if (caps.skills) command.skillIds = values.skillIds
  command.configuration = { avatar: values.avatar, permission_mode: permissionMode }
  return command
}
