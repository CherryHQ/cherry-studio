import { useAssistantApiById, useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistantDataApi'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModels'
import type { AssistantSettings, Model } from '@renderer/types'
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
      void patchAssistant(id, {
        settings: { ...assistant.settings, ...settings }
      })
    },
    [assistant, id, patchAssistant]
  )

  return {
    assistant,
    model,
    setModel: (next: Model) => {
      if (!id) return
      void patchAssistant(id, { modelId: createUniqueModelId(next.provider, next.id) })
    },
    updateAssistant: (patch: UpdateAssistantDto) => {
      if (!id) return Promise.resolve(undefined)
      return patchAssistant(id, patch)
    },
    updateAssistantSettings
  }
}
