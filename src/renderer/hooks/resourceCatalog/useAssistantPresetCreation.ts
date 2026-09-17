import { useCallback } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import {
  type AssistantCatalogPreset,
  toCreateAssistantDtoFromCatalogPreset
} from '@renderer/hooks/useAssistantCatalogPresets'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { type OfficialAssistantModelResolution, resolveOfficialAssistantModel } from '@renderer/utils/resourceCatalog'
import type { Assistant } from '@shared/data/types/assistant'

import { useAssistantMutations } from './assistantAdapter'

export type AssistantPresetCreationResult =
  | { status: 'created'; assistant: Assistant }
  | { status: 'configuration-required'; providerId: string }
  | { status: 'loading' }

export type AssistantPresetModelResolution =
  | OfficialAssistantModelResolution
  | { status: 'not-required' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }

export function useAssistantPresetCreation({ enabled = true }: { enabled?: boolean } = {}) {
  const { createAssistant } = useAssistantMutations()
  const {
    models,
    isLoading: modelsLoading,
    error: modelsError,
    refetch: refetchModels
  } = useModels(undefined, { fetchEnabled: enabled })
  const {
    providers,
    isLoading: providersLoading,
    error: providersError,
    refetch: refetchProviders
  } = useProviders(undefined, { enabled })
  const [defaultModelId] = usePreference('chat.default_model_id')
  const isLoading = modelsLoading || providersLoading
  const error = modelsError ?? providersError

  const refetch = useCallback(
    () => Promise.all([refetchModels(), refetchProviders()]),
    [refetchModels, refetchProviders]
  )

  const resolvePreset = useCallback(
    (preset: AssistantCatalogPreset): AssistantPresetModelResolution => {
      if (!preset.officialVendor) return { status: 'not-required' }
      if (error) return { status: 'error', error }
      if (isLoading) return { status: 'loading' }

      return resolveOfficialAssistantModel({
        vendor: preset.officialVendor,
        providers,
        models,
        defaultModelId
      })
    },
    [defaultModelId, error, isLoading, models, providers]
  )

  const createFromPreset = useCallback(
    async (preset: AssistantCatalogPreset): Promise<AssistantPresetCreationResult> => {
      const resolution = resolvePreset(preset)
      if (resolution.status === 'not-required') {
        return { status: 'created', assistant: await createAssistant(toCreateAssistantDtoFromCatalogPreset(preset)) }
      }
      if (resolution.status === 'loading') return resolution
      if (resolution.status === 'error') throw resolution.error
      if (resolution.status === 'configuration-required') return resolution

      const dto = toCreateAssistantDtoFromCatalogPreset(preset)
      return {
        status: 'created',
        assistant: await createAssistant({ ...dto, modelId: resolution.modelId })
      }
    },
    [createAssistant, resolvePreset]
  )

  return { createFromPreset, resolvePreset, isLoading, error, refetch }
}
