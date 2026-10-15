import type { AssistantCatalogPreset } from '@renderer/types/assistantCatalog'
import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import { createUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
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

export type SelectableModelContext = {
  models: readonly Model[]
  getProvider: (providerId: string) => Provider | undefined
  isModelSelectable: (model: Model, provider?: Provider) => boolean
}

export function isUniqueModelIdSelectable(modelId: UniqueModelId, context: SelectableModelContext): boolean {
  const model = context.models.find((candidate) => candidate.id === modelId)
  if (!model?.isEnabled) return false
  const provider = context.getProvider(model.providerId)
  if (!provider?.isEnabled) return false
  return context.isModelSelectable(model, provider)
}

export function resolveCatalogPresetModelId(
  preset: AssistantCatalogPreset,
  fallbackModelId: UniqueModelId | null | undefined,
  isModelIdSelectable?: (modelId: UniqueModelId) => boolean
): UniqueModelId | null {
  const candidates: (UniqueModelId | null | undefined)[] = []
  if (preset.defaultModel?.provider && preset.defaultModel.id) {
    candidates.push(createUniqueModelId(preset.defaultModel.provider, preset.defaultModel.id))
  }
  candidates.push(fallbackModelId)

  for (const modelId of candidates) {
    if (!modelId) continue
    if (!isModelIdSelectable || isModelIdSelectable(modelId)) return modelId
  }
  return null
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
