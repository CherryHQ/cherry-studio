import { useModels } from '@renderer/hooks/useModels'
import { usePinnedModelIds } from '@renderer/hooks/usePinnedModelIds'
import { useProviders } from '@renderer/hooks/useProviders'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { sortBy } from 'lodash'
import { useCallback, useMemo } from 'react'

import { matchesModelTag, MODEL_SELECTOR_TAGS, type ModelSelectorTag, useModelTagFilter } from './filters'
import type {
  FlatListItem,
  ModelSelectorModelItem,
  UseModelSelectorDataOptions,
  UseModelSelectorDataResult
} from './types'
import { getProviderDisplayName } from './utils'

const EMPTY_TAGS: ModelSelectorTag[] = []

function matchKeywords(keywords: string, model: Model, provider: Provider) {
  const normalizedKeywords = keywords.toLowerCase().split(/\s+/).filter(Boolean)
  if (normalizedKeywords.length === 0) {
    return true
  }

  const searchableText = [
    model.name,
    model.id,
    model.apiModelId,
    provider.name,
    provider.id,
    provider.presetProviderId,
    // UI 展示的 provider 名（内置 provider 走 i18n 翻译），确保用户按界面上看到的名字搜索能命中
    getProviderDisplayName(provider)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return normalizedKeywords.every((keyword) => searchableText.includes(keyword))
}

function getDuplicateModelNames<T extends Pick<Model, 'name'>>(models: T[]): Set<string> {
  const nameCounts = new Map<string, number>()

  for (const model of models) {
    nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
  }

  return new Set([...nameCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
}

function sortModels(models: Model[]) {
  return sortBy(models, [(model) => model.sortOrder ?? Number.MAX_SAFE_INTEGER, 'group', 'name'])
}

function getModelIdentifier(model: Model) {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

function sortProvidersByPriority(providers: Provider[], prioritizedProviderIds: string[]) {
  if (prioritizedProviderIds.length === 0) {
    return providers
  }

  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const prioritized = prioritizedProviderIds
    .map((providerId) => providerById.get(providerId))
    .filter((provider): provider is Provider => Boolean(provider))
  const prioritizedIds = new Set(prioritized.map((provider) => provider.id))
  const remaining = providers.filter((provider) => !prioritizedIds.has(provider.id))

  return [...prioritized, ...remaining]
}

export function useModelSelectorData({
  value,
  searchText,
  filter,
  showTagFilter = true,
  showPinnedModels = true,
  prioritizedProviderIds = []
}: UseModelSelectorDataOptions): UseModelSelectorDataResult {
  const { providers, isLoading: isProvidersLoading } = useProviders({ enabled: true })
  const { models, isLoading: isModelsLoading } = useModels({ enabled: true })
  const { pinnedIds, togglePin } = usePinnedModelIds()
  const { tagSelection, selectedTags, tagFilter, toggleTag, resetTags } = useModelTagFilter()

  const currentModelId = value?.id ?? ''

  const baseModelFilter = useCallback((model: Model) => filter?.(model) ?? true, [filter])

  const sortedProviders = useMemo(
    () => sortProvidersByPriority(providers, prioritizedProviderIds),
    [prioritizedProviderIds, providers]
  )

  // 交叉过滤：Provider.isEnabled 与 Model.isEnabled 互不联动，禁用 provider 下可能仍有启用 model。
  // 这里必须剔除孤儿 model，保证每条 model 都能找到对应分组。
  const modelsByProvider = useMemo(() => {
    const enabledProviderIds = new Set(sortedProviders.map((provider) => provider.id))
    const grouped = new Map<string, Model[]>()

    for (const model of models) {
      if (!enabledProviderIds.has(model.providerId) || !baseModelFilter(model)) {
        continue
      }

      const existingModels = grouped.get(model.providerId)
      if (existingModels) {
        existingModels.push(model)
      } else {
        grouped.set(model.providerId, [model])
      }
    }

    return grouped
  }, [baseModelFilter, models, sortedProviders])

  const availableTags = useMemo(() => {
    const selectableModels = [...modelsByProvider.values()].flat()
    if (selectableModels.length === 0) {
      return EMPTY_TAGS
    }

    return MODEL_SELECTOR_TAGS.filter((tag) => selectableModels.some((model) => matchesModelTag(model, tag)))
  }, [modelsByProvider])

  const searchFilter = useCallback(
    (provider: Provider) => {
      let providerModels = modelsByProvider.get(provider.id) ?? []

      if (searchText.trim()) {
        providerModels = providerModels.filter((model) => matchKeywords(searchText, model, provider))
      }

      return sortModels(providerModels)
    },
    [modelsByProvider, searchText]
  )

  const createModelItem = useCallback(
    (model: Model, provider: Provider, isPinned: boolean, showIdentifier: boolean): ModelSelectorModelItem => {
      const modelId = model.id

      return {
        key: isPinned ? `${modelId}_pinned` : modelId,
        type: 'model',
        model,
        provider,
        modelId,
        modelIdentifier: getModelIdentifier(model),
        isPinned,
        isSelected: modelId === currentModelId,
        showIdentifier
      }
    },
    [currentModelId]
  )

  const { listItems, modelItems } = useMemo(() => {
    const items: FlatListItem[] = []
    const pinnedIdSet = new Set(pinnedIds)
    const finalModelFilter = (model: Model) => (!showTagFilter || tagFilter(model)) && baseModelFilter(model)
    const duplicateNamesByProvider = new Map<string, Set<string>>(
      sortedProviders.map((provider) => [
        provider.id,
        getDuplicateModelNames(searchFilter(provider).filter((model) => (!showTagFilter ? true : tagFilter(model))))
      ])
    )

    if (searchText.length === 0 && showPinnedModels && pinnedIdSet.size > 0) {
      const pinnedItems = sortedProviders.flatMap((provider) =>
        searchFilter(provider)
          .filter(finalModelFilter)
          .filter((model) => pinnedIdSet.has(model.id))
          .map((model) =>
            createModelItem(model, provider, true, duplicateNamesByProvider.get(provider.id)?.has(model.name) ?? false)
          )
      )

      if (pinnedItems.length > 0) {
        items.push({
          key: 'pinned-group',
          type: 'group',
          title: 'pinned',
          groupKind: 'pinned'
        })
        items.push(...pinnedItems)
      }
    }

    sortedProviders.forEach((provider) => {
      const filteredModels = searchFilter(provider)
        .filter((model) => (!showTagFilter ? true : tagFilter(model)))
        .filter((model) => !showPinnedModels || searchText.length > 0 || !pinnedIdSet.has(model.id))

      if (filteredModels.length === 0) {
        return
      }

      items.push({
        key: `provider-${provider.id}`,
        type: 'group',
        title: getProviderDisplayName(provider),
        groupKind: 'provider',
        provider,
        canNavigateToSettings: provider.id !== 'cherryai'
      })

      items.push(
        ...filteredModels.map((model) =>
          createModelItem(
            model,
            provider,
            showPinnedModels && pinnedIdSet.has(model.id),
            duplicateNamesByProvider.get(provider.id)?.has(model.name) ?? false
          )
        )
      )
    })

    const selectableModelItems = items.filter((item): item is ModelSelectorModelItem => item.type === 'model')
    return { listItems: items, modelItems: selectableModelItems }
  }, [
    baseModelFilter,
    createModelItem,
    modelsByProvider,
    pinnedIds,
    searchFilter,
    searchText.length,
    showPinnedModels,
    showTagFilter,
    sortedProviders,
    tagFilter
  ])

  return {
    availableTags,
    currentModelId,
    isLoading: isProvidersLoading || isModelsLoading,
    listItems,
    modelItems,
    pinnedIds,
    resetTags,
    selectedTags,
    sortedProviders,
    tagSelection,
    togglePin,
    toggleTag
  }
}
