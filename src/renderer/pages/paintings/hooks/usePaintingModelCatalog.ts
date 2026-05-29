import { useModels } from '@renderer/hooks/useModels'
import { useProviders } from '@renderer/hooks/useProviders'
import { getProviderNameById } from '@renderer/services/ProviderService'
import { createUniqueModelId, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { DEFAULT_API_FEATURES, type Provider } from '@shared/data/types/provider'
import { useCallback, useMemo } from 'react'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import { getPaintingModelOptions, loadPaintingModelOptions } from '../model/utils/paintingModelOptions'

export interface PaintingModelCatalogData {
  providers: Provider[]
  models: Model[]
  selectedModelId?: UniqueModelId
  selectedModelName?: string
  selectedProviderName?: string
}

export interface UsePaintingModelCatalogInput {
  providerOptions: string[]
  painting: Pick<PaintingData, 'providerId' | 'model'>
}

export interface UsePaintingModelCatalogResult {
  selectorData: PaintingModelCatalogData
  currentModelOptions: ModelOption[]
  selectedModelOption?: ModelOption
  isLoading: boolean
  getModelOption: (providerId: string, modelId: string) => ModelOption | undefined
  ensureProviderCatalog: (providerId: string) => Promise<ModelOption[]>
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

function createSelectorProvider(providerId: string, provider: Provider | undefined): Provider {
  return {
    id: providerId,
    presetProviderId: provider?.presetProviderId,
    name: provider?.name || getProviderNameById(providerId) || providerId,
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: DEFAULT_API_FEATURES,
    settings: {},
    isEnabled: provider?.isEnabled ?? false
  }
}

/**
 * Build the model selector's `{ providers, models }` view + current-provider
 * lookups. All data comes from `useModels()` (already populated by SWR);
 * `ensureProviderCatalog` falls back to a direct DataApi call only when the
 * SWR cache is empty for the requested provider (e.g. the user just switched
 * to a provider whose models haven't loaded yet).
 *
 * The async-loader / `definition.mode.getModels()` indirection that lived
 * here is gone — every painting provider sources its catalog from the same
 * `/models?providerId=X` endpoint, so a single useModels() + filter covers
 * everyone.
 */
export function usePaintingModelCatalog({
  providerOptions,
  painting
}: UsePaintingModelCatalogInput): UsePaintingModelCatalogResult {
  const currentProviderId = painting.providerId
  const normalizedApiModelId = painting.model?.trim() ?? ''
  const { providers: dataProviders } = useProviders()
  const { models: dataModels, isLoading } = useModels()

  const providerMap = useMemo(() => new Map(dataProviders.map((provider) => [provider.id, provider])), [dataProviders])

  // Per-provider option list, computed once from the full models array.
  const optionsByProvider = useMemo(() => {
    const map = new Map<string, ModelOption[]>()
    for (const providerId of providerOptions) {
      map.set(providerId, getPaintingModelOptions(providerId, dataModels))
    }
    return map
  }, [dataModels, providerOptions])

  const { selectorData, modelOptionMap } = useMemo(() => {
    const providers: Provider[] = []
    const models: Model[] = []
    const seenProviderIds = new Set<string>()
    const seenModelIds = new Set<UniqueModelId>()
    const optionMap = new Map<UniqueModelId, ModelOption>()

    for (const providerId of providerOptions) {
      const providerModelOptions = optionsByProvider.get(providerId) ?? []
      if (providerModelOptions.length === 0) continue

      const provider = providerMap.get(providerId)
      if (!seenProviderIds.has(providerId)) {
        seenProviderIds.add(providerId)
        providers.push(createSelectorProvider(providerId, provider))
      }

      for (const modelOption of providerModelOptions) {
        const modelId = String(modelOption.value || '').trim()
        if (!modelId) continue
        const uniqueModelId = createUniqueModelId(providerId, modelId)
        if (seenModelIds.has(uniqueModelId)) continue
        seenModelIds.add(uniqueModelId)
        optionMap.set(uniqueModelId, modelOption)
        models.push({
          id: uniqueModelId,
          providerId,
          apiModelId: modelId,
          name: modelOption.label || modelId,
          group: modelOption.group,
          capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
          supportsStreaming: false,
          isEnabled: modelOption.isEnabled ?? true,
          isHidden: false
        })
      }
    }

    let selectedModelId: UniqueModelId | undefined
    if (normalizedApiModelId.length > 0) {
      const uniqueModelId = createUniqueModelId(currentProviderId, normalizedApiModelId)
      selectedModelId = uniqueModelId

      if (!seenModelIds.has(uniqueModelId)) {
        const currentProvider = providerMap.get(currentProviderId)
        if (!seenProviderIds.has(currentProviderId)) {
          providers.unshift(createSelectorProvider(currentProviderId, currentProvider))
        }
        models.unshift({
          id: uniqueModelId,
          providerId: currentProviderId,
          apiModelId: normalizedApiModelId,
          name: normalizedApiModelId,
          capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
          supportsStreaming: false,
          isEnabled: false,
          isHidden: false
        })
      }
    }

    const selectedModel = selectedModelId ? models.find((model) => model.id === selectedModelId) : undefined
    const selectedProvider = selectedModel
      ? providers.find((provider) => provider.id === selectedModel.providerId)
      : undefined
    const fallbackLabel =
      normalizedApiModelId.length > 0
        ? (optionMap.get(createUniqueModelId(currentProviderId, normalizedApiModelId))?.label ?? normalizedApiModelId)
        : undefined

    return {
      selectorData: {
        providers,
        models,
        selectedModelId,
        selectedModelName: selectedModel?.name ?? fallbackLabel,
        selectedProviderName: selectedProvider?.name
      },
      modelOptionMap: optionMap
    }
  }, [optionsByProvider, providerOptions, providerMap, currentProviderId, normalizedApiModelId])

  const getModelOption = useCallback(
    (providerId: string, modelId: string) => modelOptionMap.get(createUniqueModelId(providerId, modelId)),
    [modelOptionMap]
  )

  const ensureProviderCatalog = useCallback(
    async (providerId: string): Promise<ModelOption[]> => {
      const cached = optionsByProvider.get(providerId)
      if (cached && cached.length > 0) return cached
      return loadPaintingModelOptions(providerId)
    },
    [optionsByProvider]
  )

  const ensureCurrentCatalog = useCallback(
    () => ensureProviderCatalog(currentProviderId),
    [currentProviderId, ensureProviderCatalog]
  )

  const currentModelOptions = useMemo(
    () => optionsByProvider.get(currentProviderId) ?? [],
    [optionsByProvider, currentProviderId]
  )
  const selectedModelOption = useMemo(
    () => (normalizedApiModelId.length ? getModelOption(currentProviderId, normalizedApiModelId) : undefined),
    [normalizedApiModelId, currentProviderId, getModelOption]
  )

  return {
    selectorData,
    currentModelOptions,
    selectedModelOption,
    isLoading,
    getModelOption,
    ensureProviderCatalog,
    ensureCurrentCatalog
  }
}
