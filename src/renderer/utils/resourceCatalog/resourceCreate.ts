import type { AssistantCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

const DEFAULT_AGENT_CREATE_TYPE = 'claude-code' as const

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
/** Map a bundled assistant-catalog preset to an Agent create command (default runtime: claude-code). */
export function toCreateAgentCommandFromCatalogPreset(
  preset: AssistantCatalogPreset,
  modelId: UniqueModelId
): CreateAgentCommand {
  const caps = AGENT_RUNTIME_CAPABILITIES[DEFAULT_AGENT_CREATE_TYPE]
  const permissionMode = caps.createDefaults.permissionMode
  const name = preset.name.trim()
  const instructions = preset.prompt?.trim() ?? ''
  const description = preset.description?.trim()
  const avatar = preset.emoji?.trim() || '🤖'

  return {
    type: DEFAULT_AGENT_CREATE_TYPE,
    name,
    model: modelId,
    ...(caps.modelTiers ? { planModel: modelId, smallModel: modelId } : {}),
    ...(description ? { description } : {}),
    instructions,
    configuration: {
      avatar,
      permission_mode: permissionMode
    }
  }
}

export function resolveCatalogPresetModelId(
  preset: AssistantCatalogPreset,
  fallbackModelId: UniqueModelId | null | undefined
): UniqueModelId | null {
  if (preset.defaultModel?.provider && preset.defaultModel.id) {
    return createUniqueModelId(preset.defaultModel.provider, preset.defaultModel.id)
  }
  return fallbackModelId ?? null
}

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
      permission_mode: permissionMode
    }
  }
}
