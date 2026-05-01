import { useAssistantApiById, useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistantDataApi'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModels'
import type { AssistantSettings, Model } from '@renderer/types'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/modelReconcile'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'

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

export function useAssistant(id: string) {
  const { assistant } = useAssistantApiById(id)
  const { updateAssistant: patchAssistant } = useAssistantMutations()
  const { defaultModel } = useDefaultModel()

  const modelId = (assistant?.modelId ?? defaultModel?.id) as UniqueModelId
  const { model } = useModelById(modelId)

  const updateAssistantSettings = useCallback(
    (settings: Partial<AssistantSettings>) => {
      if (!id || !assistant) return
      void patchAssistant(id, { settings })
    },
    [assistant, id, patchAssistant]
  )

  return {
    assistant,
    model,
    setModel: (next: Model, extraSettings?: Partial<AssistantSettings>) => {
      if (!id || !assistant) return
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
      return patchAssistant(id, patch)
    },
    updateAssistantSettings
  }
}
