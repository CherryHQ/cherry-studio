import { loggerService } from '@logger'
import { useModels } from '@renderer/hooks/useModels'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { getProviderNameById } from '@renderer/services/ProviderService'
import type { Provider as RendererProvider } from '@renderer/types'
import {
  createUniqueModelId,
  ENDPOINT_TYPE,
  type Model,
  MODEL_CAPABILITY,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import type { PaintingMode } from '@shared/data/types/painting'
import { DEFAULT_API_FEATURES, type Provider } from '@shared/data/types/provider'
import md5 from 'md5'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModelOption } from '../hooks/useModelLoader'
import { providerRegistry } from '../providers/registry'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../workspace/utils/paintingProviderMode'

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
  currentModelOptions: ModelOption[]
  isCurrentLoading?: boolean
  isOpen: boolean
}

export interface UsePaintingModelSelectorCatalogResult {
  selectorData: PaintingModelSelectorCatalogData
  isLoading: boolean
  currentCatalogError?: Error
  getModelOption: (providerId: string, modelId: string) => ModelOption | undefined
  ensureProviderCatalog: (providerId: string) => Promise<ModelOption[]>
  ensureCurrentCatalog: () => Promise<ModelOption[]>
}

function createSelectorProvider(providerId: string, provider: RendererProvider | undefined): Provider {
  return {
    id: providerId,
    presetProviderId: provider?.isSystem ? providerId : provider?.type,
    name: provider?.name || getProviderNameById(providerId) || providerId,
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: DEFAULT_API_FEATURES,
    settings: {},
    isEnabled: provider?.enabled ?? false
  }
}

function createModelOptionFromV2Model(model: Model): ModelOption {
  return {
    label: model.name || model.apiModelId || parseUniqueModelId(model.id).modelId,
    value: model.apiModelId || parseUniqueModelId(model.id).modelId,
    group: model.group,
    isEnabled: model.isEnabled,
    _raw: model
  }
}

function supportsImageGenerationEndpoint(model: Model): boolean {
  if (model.endpointTypes?.length) {
    return model.endpointTypes.includes(ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION)
  }

  return model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)
}

function getV2ModelOptions(providerId: string, v2Models: Model[]): ModelOption[] {
  return v2Models
    .filter((model) => model.providerId === providerId && !model.isHidden && supportsImageGenerationEndpoint(model))
    .map(createModelOptionFromV2Model)
}

function shouldPreferV2Catalog(providerId: string): boolean {
  return providerId === 'ovms' || !providerRegistry[providerId]
}

function getAsyncCatalogKey(providerId: string, targetTab: string, provider: RendererProvider | undefined): string {
  if (providerId === 'tokenflux') {
    return `${providerId}:${provider?.apiHost ?? ''}:${md5(provider?.apiKey || 'anonymous')}`
  }

  return `${providerId}:${targetTab}`
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Failed to load painting models')
}

export function usePaintingModelSelectorCatalog({
  providerOptions,
  currentProviderId,
  currentMode,
  currentModelId,
  currentModelOptions,
  isCurrentLoading = false,
  isOpen
}: UsePaintingModelSelectorCatalogInput): UsePaintingModelSelectorCatalogResult {
  const rendererProviders = useAllProviders()
  const shouldLoadV2Models = isOpen || shouldPreferV2Catalog(currentProviderId)
  const { models: v2Models, isLoading: isV2ModelsLoading } = useModels(undefined, { fetchEnabled: shouldLoadV2Models })
  const [catalogVersion, setCatalogVersion] = useState(0)
  const openedOnceRef = useRef(false)

  const rendererProviderMap = useMemo(
    () => new Map(rendererProviders.map((provider) => [provider.id, provider])),
    [rendererProviders]
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

      const v2Options = shouldPreferV2Catalog(providerId) ? getV2ModelOptions(providerId, v2Models) : []
      if (v2Options.length > 0) {
        return v2Options
      }

      if (providerId === currentProviderId && currentModelOptions.length > 0) {
        return currentModelOptions
      }

      const definition = resolvePaintingProviderDefinition(providerId)
      const modelConfig = definition.mode.getModels(targetTab)
      const provider = rendererProviderMap.get(providerId)

      if (modelConfig.type === 'static') {
        return modelConfig.options
      }

      if (modelConfig.type === 'dynamic') {
        return modelConfig.resolver((provider ?? { id: providerId, name: providerId, models: [] }) as RendererProvider)
      }

      const key = getAsyncCatalogKey(providerId, targetTab, provider)
      return asyncCatalogCache.get(key)?.options ?? []
    },
    [currentModelOptions, currentProviderId, getTargetTab, rendererProviderMap, v2Models]
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

      const provider = rendererProviderMap.get(providerId)
      const key = getAsyncCatalogKey(providerId, targetTab, provider)
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
    [getSyncOptions, getTargetTab, rendererProviderMap]
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

      const provider = rendererProviderMap.get(providerId)
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
        const currentProvider = rendererProviderMap.get(currentProviderId)

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
  }, [
    catalogVersion,
    currentModelId,
    currentProviderId,
    getSyncOptions,
    getTargetTab,
    providerOptions,
    rendererProviderMap
  ])

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

  return {
    selectorData,
    isLoading: isV2ModelsLoading || isCurrentLoading || isAsyncLoading,
    currentCatalogError,
    getModelOption,
    ensureProviderCatalog,
    ensureCurrentCatalog
  }
}
