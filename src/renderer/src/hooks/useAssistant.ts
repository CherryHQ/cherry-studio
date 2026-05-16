import { usePreference } from '@data/hooks/usePreference'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAssistantApiById, useAssistantMutations, useAssistantsApi } from '@renderer/hooks/useAssistantDataApi'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModels'
import { composeDefaultAssistant } from '@renderer/services/defaultAssistant'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { reconcileReasoningEffortForModel, reconcileWebSearchForModel } from '@renderer/utils/modelReconcile'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Model } from '@shared/data/types/model'
import { type UniqueModelId } from '@shared/data/types/model'
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
 * Returns the runtime-composed default-assistant template. Use this only at
 * UI sites that need to render the "Default" preset card or seed a new
 * assistant from the template (e.g. settings pages). It is
 * NOT meant for chat call sites — a topic without an assistant should be
 * rendered by handling `useAssistant(...).assistant === undefined` directly,
 * not by faking up an Assistant.
 */
export function useDefaultAssistant(): { assistant: Assistant } {
  const [defaultModelId] = usePreference('chat.default_model_id')
  const modelId = (defaultModelId ?? null) as UniqueModelId | null
  const assistant = useMemo(() => composeDefaultAssistant(modelId), [modelId])
  return { assistant }
}

/**
 * Hook for a single persisted assistant. Returns `assistant: undefined` when
 * `id` is empty / null — callers should fall back to UI defaults (e.g.
 * `assistant?.name ?? t('chat.default.name')`) rather than receiving a
 * synthesised default Assistant. There is no special-case branch for the
 * "default assistant" — a topic with no assistant carries
 * `assistantId: undefined`, not a sentinel.
 */
export function useAssistant(id: string | null | undefined) {
  const { assistant } = useAssistantApiById(id ?? undefined)
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
      // reconcile* still consume the v1 Model shape (their reasoning-effort
      // chain goes through the /config/models v1 adapter); bridge once here
      // so call sites pass the v2 Model directly. next.id is the UniqueModelId.
      const v1Next = fromSharedModel(next)
      const reasoning = reconcileReasoningEffortForModel(v1Next, assistant.settings.reasoning_effort, id)
      const webSearch = reconcileWebSearchForModel(v1Next, assistant.settings)
      const settingsPatch =
        extraSettings || reasoning || webSearch
          ? { ...assistant.settings, ...extraSettings, ...reasoning, ...webSearch }
          : undefined
      void patchAssistant(id, settingsPatch ? { modelId: next.id, settings: settingsPatch } : { modelId: next.id })
    },
    updateAssistant: (patch: UpdateAssistantDto) => {
      if (!id) return Promise.resolve(undefined)
      return patchAssistant(id, patch)
    },
    updateAssistantSettings
  }
}
