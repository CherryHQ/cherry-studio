import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModels'
import { useProviders } from '@renderer/hooks/useProviders'
import { getProviderNameById } from '@renderer/services/ProviderService'
import { createUniqueModelId, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'
import { DEFAULT_API_FEATURES, type Provider } from '@shared/data/types/provider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModelOption } from '../model/types/paintingModel'
import { createPaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { getPaintingModelOptions } from '../model/utils/paintingModelOptions'
import { providerRegistry } from '../providers/registry'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../utils/paintingProviderMode'

const logger = loggerService.withContext('usePaintingModelSelectorCatalog')

type AsyncCatalogEntry =
  | { status: 'idle'; options: ModelOption[]; error?: undefined; promise?: undefined }
  | { status: 'loading'; options: ModelOption[]; error?: undefined; promise: Promise<ModelOption[]> }
  | { status: 'ready'; options: ModelOption[]; error?: undefined; promise?: undefined }
  | { status: 'error'; options: ModelOption[]; error: Error; promise?: undefined }

const asyncCatalogCache = new Map<string, AsyncCatalogEntry>()

export interface PaintingModelSelectorCatalogData {
  providers: Provider[]
  models: Model[]
  selectedModelId?: UniqueModelId
  selectedModelName?: string
  selectedProviderName?: string
}

export interface UsePaintingModelSelectorCatalogInput {
  providerOptions: string[]
  currentProviderId: string
  currentMode: PaintingMode
  currentModelId?: string
  isOpen: boolean
}

export interface UsePaintingModelSelectorCatalogResult {
  selectorData: PaintingModelSelectorCatalogData
  currentModelOptions: ModelOption[]
  selectedModelOption?: ModelOption
  isLoading: boolean
  currentCatalogError?: Error
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

function shouldUseDataModelCatalog(providerId: string): boolean {
  return providerId === 'ovms' || !providerRegistry[providerId]
}

function getAsyncCatalogKey(providerId: string, targetTab: string, provider: Provider | undefined): string {
  if (providerId === 'tokenflux') {
    const keyIds = provider?.apiKeys.map((key) => key.id).join(',') ?? ''
    return `${providerId}:${JSON.stringify(provider?.endpointConfigs ?? {})}:${keyIds}`
  }

  return `${providerId}:${targetTab}`
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Failed to load painting models')
}

function resolveRuntimeProvider(
  providerId: string,
  providerMap: Map<string, Provider>,
  runtimeProviderMap: Map<string, ReturnType<typeof createPaintingProviderRuntime>>
) {
  return runtimeProviderMap.get(providerId) ?? createPaintingProviderRuntime(providerMap.get(providerId), providerId)
}

export function usePaintingModelSelectorCatalog({
  providerOptions,
  currentProviderId,
  currentMode,
  currentModelId,
  isOpen
}: UsePaintingModelSelectorCatalogInput): UsePaintingModelSelectorCatalogResult {
  const { providers: dataProviders } = useProviders()
  const shouldLoadModels = isOpen || shouldUseDataModelCatalog(currentProviderId)
  const { models: dataModels, isLoading: isModelsLoading } = useModels(undefined, { fetchEnabled: shouldLoadModels })
  const [catalogVersion, setCatalogVersion] = useState(0)
  const openedOnceRef = useRef(false)

  const providerMap = useMemo(() => new Map(dataProviders.map((provider) => [provider.id, provider])), [dataProviders])

  const runtimeProviderMap = useMemo(
    () => new Map(dataProviders.map((provider) => [provider.id, createPaintingProviderRuntime(provider, provider.id)])),
    [dataProviders]
  )

  const getTargetTab = useCallback(
    (providerId: string) => {
      const definition = resolvePaintingProviderDefinition(providerId)
      return resolvePaintingTabForMode(definition, currentMode)
    },
    [currentMode]
  )

  const getSyncOptions = useCallback(
    (providerId: string): ModelOption[] => {
      const targetTab = getTargetTab(providerId)

      if (!targetTab) {
        return []
      }

      const dataModelOptions = shouldUseDataModelCatalog(providerId)
        ? getPaintingModelOptions(providerId, dataModels)
        : []
      if (dataModelOptions.length > 0) {
        return dataModelOptions
      }

      const definition = resolvePaintingProviderDefinition(providerId)
      const modelConfig = definition.mode.getModels(targetTab)
      const provider = resolveRuntimeProvider(providerId, providerMap, runtimeProviderMap)

      if (modelConfig.type === 'static') {
        return modelConfig.options
      }

      if (modelConfig.type === 'dynamic') {
        return modelConfig.resolver(provider)
      }

      const key = getAsyncCatalogKey(providerId, targetTab, providerMap.get(providerId))
      return asyncCatalogCache.get(key)?.options ?? []
    },
    [dataModels, getTargetTab, providerMap, runtimeProviderMap]
  )

  const loadAsyncOptions = useCallback(
    async (providerId: string): Promise<ModelOption[]> => {
      const targetTab = getTargetTab(providerId)

      if (!targetTab) {
        return []
      }

      const definition = resolvePaintingProviderDefinition(providerId)
      const modelConfig = definition.mode.getModels(targetTab)

      if (modelConfig.type !== 'async') {
        return getSyncOptions(providerId)
      }

      const provider = resolveRuntimeProvider(providerId, providerMap, runtimeProviderMap)
      const key = getAsyncCatalogKey(providerId, targetTab, providerMap.get(providerId))
      const cached = asyncCatalogCache.get(key)

      if (cached?.status === 'ready') {
        return cached.options
      }

      if (cached?.status === 'loading') {
        return cached.promise
      }

      const promise = modelConfig.loader(provider)
      asyncCatalogCache.set(key, { status: 'loading', options: cached?.options ?? [], promise })
      setCatalogVersion((version) => version + 1)

      try {
        const options = await promise
        asyncCatalogCache.set(key, { status: 'ready', options })
        setCatalogVersion((version) => version + 1)
        return options
      } catch (error) {
        const nextError = toError(error)
        logger.error('Failed to load painting model catalog', nextError, { providerId })
        asyncCatalogCache.set(key, { status: 'error', options: [], error: nextError })
        setCatalogVersion((version) => version + 1)
        throw nextError
      }
    },
    [getSyncOptions, getTargetTab, providerMap, runtimeProviderMap]
  )

  useEffect(() => {
    if (!isOpen || openedOnceRef.current) {
      return
    }

    openedOnceRef.current = true

    for (const providerId of providerOptions) {
      if (providerId === currentProviderId || !getTargetTab(providerId)) {
        continue
      }

      const modelConfig = resolvePaintingProviderDefinition(providerId).mode.getModels(getTargetTab(providerId)!)
      if (modelConfig.type === 'async') {
        void loadAsyncOptions(providerId).catch(() => undefined)
      }
    }
  }, [currentProviderId, getTargetTab, isOpen, loadAsyncOptions, providerOptions])

  useEffect(() => {
    const targetTab = getTargetTab(currentProviderId)
    if (!targetTab) {
      return
    }

    const modelConfig = resolvePaintingProviderDefinition(currentProviderId).mode.getModels(targetTab)
    if (modelConfig.type !== 'async') {
      return
    }

    void loadAsyncOptions(currentProviderId).catch(() => undefined)
  }, [currentProviderId, getTargetTab, loadAsyncOptions])

  const { selectorData, modelOptionMap, isAsyncLoading, currentCatalogError } = useMemo(() => {
    void catalogVersion

    const providers: Provider[] = []
    const models: Model[] = []
    const seenProviderIds = new Set<string>()
    const seenModelIds = new Set<UniqueModelId>()
    const optionMap = new Map<UniqueModelId, ModelOption>()
    let asyncLoading = false
    let currentError: Error | undefined

    for (const [providerIndex, providerId] of providerOptions.entries()) {
      const targetTab = getTargetTab(providerId)
      if (!targetTab) {
        continue
      }

      const provider = providerMap.get(providerId)
      const definition = resolvePaintingProviderDefinition(providerId)
      const modelConfig = definition.mode.getModels(targetTab)
      const asyncKey = modelConfig.type === 'async' ? getAsyncCatalogKey(providerId, targetTab, provider) : undefined
      const asyncEntry = asyncKey ? asyncCatalogCache.get(asyncKey) : undefined

      if (modelConfig.type === 'async' && asyncEntry?.status === 'loading') {
        asyncLoading = true
      }

      if (providerId === currentProviderId && asyncEntry?.status === 'error') {
        currentError = asyncEntry.error
      }

      const providerModelOptions = getSyncOptions(providerId)

      if (providerModelOptions.length === 0) {
        continue
      }

      if (!seenProviderIds.has(providerId)) {
        seenProviderIds.add(providerId)
        providers.push(createSelectorProvider(providerId, provider))
      }

      providerModelOptions.forEach((modelOption, modelIndex) => {
        const modelId = String(modelOption.value || '').trim()
        if (!modelId) {
          return
        }

        const uniqueModelId = createUniqueModelId(providerId, modelId)
        if (seenModelIds.has(uniqueModelId)) {
          return
        }

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
          isHidden: false,
          sortOrder: providerIndex * 1000 + modelIndex
        })
      })
    }

    let selectedModelId: UniqueModelId | undefined
    if (currentModelId) {
      const uniqueModelId = createUniqueModelId(currentProviderId, currentModelId)
      selectedModelId = uniqueModelId

      if (!seenModelIds.has(uniqueModelId)) {
        const currentProvider = providerMap.get(currentProviderId)

        if (!seenProviderIds.has(currentProviderId)) {
          providers.unshift(createSelectorProvider(currentProviderId, currentProvider))
        }

        models.unshift({
          id: uniqueModelId,
          providerId: currentProviderId,
          apiModelId: currentModelId,
          name: currentModelId,
          capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
          supportsStreaming: false,
          isEnabled: false,
          isHidden: false,
          sortOrder: -1
        })
      }
    }

    const selectedModel = selectedModelId ? models.find((model) => model.id === selectedModelId) : undefined
    const selectedProvider = selectedModel
      ? providers.find((provider) => provider.id === selectedModel.providerId)
      : undefined

    return {
      selectorData: {
        providers,
        models,
        selectedModelId,
        selectedModelName: selectedModel?.name,
        selectedProviderName: selectedProvider?.name
      },
      modelOptionMap: optionMap,
      isAsyncLoading: asyncLoading,
      currentCatalogError: currentError
    }
  }, [catalogVersion, currentModelId, currentProviderId, getSyncOptions, getTargetTab, providerMap, providerOptions])

  const getModelOption = useCallback(
    (providerId: string, modelId: string) => {
      return modelOptionMap.get(createUniqueModelId(providerId, modelId))
    },
    [modelOptionMap]
  )

  const ensureProviderCatalog = useCallback(
    async (providerId: string) => {
      const options = getSyncOptions(providerId)
      if (options.length > 0) {
        return options
      }

      return loadAsyncOptions(providerId)
    },
    [getSyncOptions, loadAsyncOptions]
  )

  const ensureCurrentCatalog = useCallback(
    () => ensureProviderCatalog(currentProviderId),
    [currentProviderId, ensureProviderCatalog]
  )

  const currentModelOptions = useMemo(() => getSyncOptions(currentProviderId), [currentProviderId, getSyncOptions])
  const selectedModelOption = useMemo(() => {
    if (!currentModelId) {
      return undefined
    }

    return getModelOption(currentProviderId, currentModelId)
  }, [currentModelId, currentProviderId, getModelOption])

  return {
    selectorData,
    currentModelOptions,
    selectedModelOption,
    isLoading: isModelsLoading || isAsyncLoading,
    currentCatalogError,
    getModelOption,
    ensureProviderCatalog,
    ensureCurrentCatalog
  }
}
