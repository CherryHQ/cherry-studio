import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import { type AssistantReplyLanguage, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'

/** The avatar a new Assistant starts with when none (or no valid emoji) was chosen. */
export const DEFAULT_ASSISTANT_CREATE_AVATAR = '💬'

/** The values every Assistant create entry point (wizard, auto create, conversation tools) collects. */
export type AssistantCreateValues = {
  avatar: string
  name: string
  modelId: UniqueModelId
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  mcpServerIds?: string[]
  enableWebSearch?: boolean
  /** Absent leaves the Assistant unconstrained, like one saved before the setting existed. */
  replyLanguage?: AssistantReplyLanguage
}

/** Map the shared create values to the Assistant DataApi contract. */
export function buildCreateAssistantDto(values: AssistantCreateValues): CreateAssistantDto {
  const settingsPatch = {
    ...(values.enableWebSearch ? { enableWebSearch: true } : {}),
    ...(values.replyLanguage ? { replyLanguage: values.replyLanguage } : {})
  }
  return {
    name: values.name,
    emoji: values.avatar,
    modelId: values.modelId,
    description: values.description,
    prompt: values.prompt,
    knowledgeBaseIds: values.knowledgeBaseIds,
    ...(values.mcpServerIds?.length ? { mcpServerIds: values.mcpServerIds } : {}),
    ...(Object.keys(settingsPatch).length ? { settings: { ...DEFAULT_ASSISTANT_SETTINGS, ...settingsPatch } } : {})
  }
}
