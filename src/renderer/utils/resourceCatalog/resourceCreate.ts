import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

/** Map the shared create-wizard values to the Assistant DataApi contract. */
export function buildCreateAssistantDto(values: ResourceCreateValues): CreateAssistantDto {
  return {
    name: values.name,
    emoji: values.avatar,
    modelId: values.modelId,
    description: values.description,
    prompt: values.prompt,
    knowledgeBaseIds: values.knowledgeBaseIds,
    ...(values.mcpServerIds?.length ? { mcpServerIds: values.mcpServerIds } : {}),
    ...(values.enableWebSearch ? { settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableWebSearch: true } } : {})
  }
}
