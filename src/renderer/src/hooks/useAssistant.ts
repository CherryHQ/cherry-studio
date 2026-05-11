import { usePreference } from '@data/hooks/usePreference'
import { useAssistantApiById, useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistantDataApi'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModels'
import { composeDefaultAssistant } from '@renderer/services/defaultAssistant'
import type { Assistant, AssistantSettings, Model } from '@renderer/types'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/modelReconcile'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

export function useAssistants() {
  const { assistants, isLoading, error, refetch } = useAssistantsApi()
  const { createAssistant, deleteAssistant, updateAssistant } = useAssistantMutations()

  return {
    assistants,
    isLoading,
    error,
    refetch,
    addAssistant: (dto: CreateAssistantDto) => createAssistant(dto),
    removeAssistant: (id: string) => deleteAssistant(id),
    updateAssistant: (id: string, patch: UpdateAssistantDto) => updateAssistant(id, patch)
  }
}

/**
 * Runtime-composed default assistant. v2 stores no `id='default'` row in
 * SQLite — the default assistant is always synthesized from a static template
 * plus the live `chat.default_model_id` preference. Returned `assistant` is
 * always defined (no loading state). Resolve the underlying `Model` via
 * {@link useDefaultModel} when needed; this hook intentionally does not
 * return it to keep responsibilities separate.
 */
export function useDefaultAssistant(): { assistant: Assistant } {
  const [defaultModelId] = usePreference('chat.default_model_id')
  const modelId = (defaultModelId ?? null) as UniqueModelId | null
  const assistant = useMemo(() => composeDefaultAssistant(modelId), [modelId])
  return { assistant }
}

export function useAssistant(id: string) {
  const isDefaultAssistant = id === DEFAULT_ASSISTANT_ID
  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { assistant: apiAssistant } = useAssistantApiById(isDefaultAssistant ? undefined : id)
  const { updateAssistant: patchAssistant } = useAssistantMutations()
  const { defaultModel } = useDefaultModel()
  const [, setDefaultModelId] = usePreference('chat.default_model_id')

  const assistant = isDefaultAssistant ? defaultAssistant : apiAssistant
  const modelId = (assistant?.modelId ?? defaultModel?.id) as UniqueModelId
  const { model } = useModelById(modelId)

  const updateAssistantSettings = useCallback(
    (settings: Partial<AssistantSettings>) => {
      if (!id || !assistant) return
      if (isDefaultAssistant) return
      void patchAssistant(id, { settings })
    },
    [assistant, id, isDefaultAssistant, patchAssistant]
  )

  return {
    assistant,
    model,
    setModel: (next: Model, extraSettings?: Partial<AssistantSettings>) => {
      if (!id || !assistant) return
      if (isDefaultAssistant) {
        void setDefaultModelId(createUniqueModelId(next.provider, next.id))
        return
      }
      const reasoning = reconcileReasoningEffortForModel(next, assistant.settings.reasoning_effort, id)
      const webSearch = reconcileWebSearchForModel(next, assistant.settings)
      const settingsPatch =
        extraSettings || reasoning || webSearch
          ? { ...assistant.settings, ...extraSettings, ...reasoning, ...webSearch }
          : undefined
      void patchAssistant(
        id,
        settingsPatch
          ? { modelId: createUniqueModelId(next.provider, next.id), settings: settingsPatch }
          : { modelId: createUniqueModelId(next.provider, next.id) }
      )
    },
    updateAssistant: (patch: UpdateAssistantDto) => {
      if (!id) return Promise.resolve(undefined)
      if (isDefaultAssistant) {
        const nextModelId = patch.modelId
        if (nextModelId) {
          return setDefaultModelId(nextModelId).then(() => composeDefaultAssistant(nextModelId))
        }
        return Promise.resolve(assistant)
      }
      return patchAssistant(id, patch)
    },
    updateAssistantSettings
  }
}
