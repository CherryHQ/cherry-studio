import { modelMatchesDisplayTag } from '@renderer/components/Tags/Model'
import { useModels } from '@renderer/hooks/useModel'
import { usePins } from '@renderer/hooks/usePins'
import { useProviders } from '@renderer/hooks/useProvider'
import { getSearchMatchScore } from '@renderer/utils/modelSearch'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { sortBy } from 'lodash'
import { useCallback, useMemo } from 'react'

import { MODEL_SELECTOR_TAGS, type ModelSelectorTag, useModelTagFilter } from './filters'
import type {
  FlatListItem,
  ModelSelectorModelItem,
  UseModelSelectorDataOptions,
  UseModelSelectorDataResult
} from './types'
import { getProviderDisplayName } from './utils'

const EMPTY_TAGS: ModelSelectorTag[] = []
const SELECTOR_LIST_SWR_OPTIONS = { revalidateOnFocus: true } as const
const CHERRYAI_SETTINGS_PROVIDER_ID = 'cherryin'

function getModelSearchScore(keywords: string, model: Model, provider: Provider, providerDisplayName: string) {
  return getSearchMatchScore(keywords, [
    { value: model.name, weight: 0, allowAbbreviation: true },
    { value: model.apiModelId, weight: 1, allowAbbreviation: true },
    { value: model.id, weight: 1, allowAbbreviation: true },
    { value: provider.name, weight: 2, allowAbbreviation: false },
    { value: provider.id, weight: 2, allowAbbreviation: false },
    { value: provider.presetProviderId, weight: 2, allowAbbreviation: false },
    // UI 展示的 provider 名（内置 provider 走 i18n 翻译），确保用户按界面上看到的名字搜索能命中
    { value: providerDisplayName, weight: 2, allowAbbreviation: false }
  ])
}

function getDuplicateModelNames<T extends Pick<Model, 'name'>>(models: T[]): Set<string> {
  const nameCounts = new Map<string, number>()

  for (const model of models) {
    nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
  }

  return new Set([...nameCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
}

function sortModels(models: Model[]) {
  return sortBy(models, ['group', 'name'])
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

function getProviderSettingsProviderId(provider: Provider): string {
  return provider.id === CHERRYAI_PROVIDER_ID ? CHERRYAI_SETTINGS_PROVIDER_ID : provider.id
}

export function useModelSelectorData({
  selectedModelIds = [],
  maxSelectedCount,
  searchText,
  filter,
  showTagFilter = true,
  showPinnedModels = true,
  prioritizedProviderIds = []
}: UseModelSelectorDataOptions): UseModelSelectorDataResult {
  const {
    providers,
    isLoading: isProvidersLoading,
    refetch: refetchProviders
  } = useProviders({ enabled: true }, { swrOptions: SELECTOR_LIST_SWR_OPTIONS })
  const {
    models,
    isLoading: isModelsLoading,
    refetch: refetchModels
  } = useModels({ enabled: true }, { swrOptions: SELECTOR_LIST_SWR_OPTIONS })
  const {
    isLoading: isPinsLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    pinnedIds: rawPinnedIds,
    refetch: refetchPinnedModels,
    togglePin
  } = usePins('model')
  const { tagSelection, selectedTags, tagFilter, toggleTag, resetTags } = useModelTagFilter()

  const pinnedIds = useMemo(() => rawPinnedIds.filter(isUniqueModelId), [rawPinnedIds])
  const availableProviders = providers
  const availableModels = models

  const baseModelFilter = useCallback((model: Model) => filter?.(model) ?? true, [filter])

  const sortedProviders = useMemo(
    () => sortProvidersByPriority(availableProviders, prioritizedProviderIds),
    [availableProviders, prioritizedProviderIds]
  )

  // 交叉过滤：Provider.isEnabled 与 Model.isEnabled 互不联动，禁用 provider 下可能仍有启用 model。
  // 这里必须剔除孤儿 model，保证每条 model 都能找到对应分组。
  const modelsByProvider = useMemo(() => {
    const enabledProviderIds = new Set(sortedProviders.map((provider) => provider.id))
    const grouped = new Map<string, Model[]>()

    for (const model of availableModels) {
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
  }, [availableModels, baseModelFilter, sortedProviders])

  const availableTags = useMemo(() => {
    const selectableModels = [...modelsByProvider.values()].flat()
    if (selectableModels.length === 0) {
      return EMPTY_TAGS
    }

    return MODEL_SELECTOR_TAGS.filter((tag) => selectableModels.some((model) => modelMatchesDisplayTag(model, tag)))
  }, [modelsByProvider])

  const selectableModelsById = useMemo(() => {
    const entries = [...modelsByProvider.values()].flat().map((model) => [model.id, model] as const)
    return new Map(entries)
  }, [modelsByProvider])

  // 只做去重 + 剔除不可选的脏 ID，不做数量截断。
  // 截断只影响 UI 的"显示为选中"态，不能让截断污染到对外回传的业务数据。
  const resolvedSelectedModelIds = useMemo(() => {
    const nextSelectedIds: UniqueModelId[] = []
    const seen = new Set<UniqueModelId>()

    for (const modelId of selectedModelIds) {
      if (seen.has(modelId) || !selectableModelsById.has(modelId)) {
        continue
      }

      seen.add(modelId)
      nextSelectedIds.push(modelId)
    }

    return nextSelectedIds
  }, [selectableModelsById, selectedModelIds])

  // 仅用于 UI 展示：受 maxSelectedCount 约束（例如单选时只让第一个显示"已选"态）
  const visibleSelectedModelIdSet = useMemo(() => {
    if (maxSelectedCount == null) {
      return new Set(resolvedSelectedModelIds)
    }

    return new Set(resolvedSelectedModelIds.slice(0, maxSelectedCount))
  }, [maxSelectedCount, resolvedSelectedModelIds])

  const searchFilter = useCallback(
    (provider: Provider) => {
      const providerModels = modelsByProvider.get(provider.id) ?? []

      if (searchText.trim()) {
        const providerDisplayName = getProviderDisplayName(provider)
        return sortBy(
          providerModels.flatMap((model) => {
            const searchScore = getModelSearchScore(searchText, model, provider, providerDisplayName)
            return searchScore === null ? [] : [{ model, searchScore }]
          }),
          ['searchScore', 'model.group', 'model.name']
        ).map(({ model }) => model)
      }

      return sortModels(providerModels)
    },
    [modelsByProvider, searchText]
  )

  const filteredModelsByProvider = useMemo(() => {
    const nextFilteredModels = new Map<string, Model[]>()

    sortedProviders.forEach((provider) => {
      const filteredModels = searchFilter(provider).filter((model) => (!showTagFilter ? true : tagFilter(model)))
      nextFilteredModels.set(provider.id, filteredModels)
    })

    return nextFilteredModels
  }, [searchFilter, showTagFilter, sortedProviders, tagFilter])

  const duplicateNamesByProvider = useMemo(
    () =>
      new Map(
        sortedProviders.map((provider) => [
          provider.id,
          getDuplicateModelNames(filteredModelsByProvider.get(provider.id) ?? [])
        ])
      ),
    [filteredModelsByProvider, sortedProviders]
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
        showIdentifier
      }
    },
    []
  )

  const { listItems, modelItems } = useMemo(() => {
    const items: FlatListItem[] = []
    const pinnedIdSet = new Set(pinnedIds)
    const providerById = new Map(sortedProviders.map((provider) => [provider.id, provider]))
    const finalModelFilter = (model: Model) => (!showTagFilter || tagFilter(model)) && baseModelFilter(model)
    // `searchFilter(provider)` runs fuzzy scoring + sort per provider; cache the tag-filtered
    // result so duplicate-name detection and the list below share one pass per provider.
    const tagFilteredModelsByProvider = new Map<string, Model[]>(
      sortedProviders.map((provider) => [
        provider.id,
        searchFilter(provider).filter((model) => (!showTagFilter ? true : tagFilter(model)))
      ])
    )
    const duplicateNamesByProvider = new Map<string, Set<string>>(
      sortedProviders.map((provider) => [
        provider.id,
        getDuplicateModelNames(tagFilteredModelsByProvider.get(provider.id) ?? [])
      ])
    )

    if (searchText.length === 0 && showPinnedModels && pinnedIdSet.size > 0) {
      const pinnedItems = pinnedIds.flatMap((modelId) => {
        const model = selectableModelsById.get(modelId)
        const provider = model ? providerById.get(model.providerId) : undefined
        if (!model || !provider || !finalModelFilter(model)) {
          return []
        }

        return [
          createModelItem(model, provider, true, duplicateNamesByProvider.get(provider.id)?.has(model.name) ?? false)
        ]
      })

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
      const filteredModels = (tagFilteredModelsByProvider.get(provider.id) ?? []).filter(
        (model) => !showPinnedModels || searchText.length > 0 || !pinnedIdSet.has(model.id)
      )

      if (filteredModels.length === 0) {
        return
      }

      items.push({
        key: `provider-${provider.id}`,
        type: 'group',
        title: getProviderDisplayName(provider),
        groupKind: 'provider',
        provider,
        canNavigateToSettings: true,
        settingsProviderId: getProviderSettingsProviderId(provider)
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
    createModelItem,
    duplicateNamesByProvider,
    filteredModelsByProvider,
    pinnedIds,
    selectableModelsById,
    searchText.length,
    showPinnedModels,
    showTagFilter,
    sortedProviders,
    tagFilter
  ])

  return {
    availableTags,
    isLoading: isProvidersLoading || isModelsLoading || isPinsLoading,
    isPinActionDisabled: isPinsLoading || isPinsRefreshing || isPinsMutating,
    listItems,
    modelItems,
    pinnedIds,
    refetchModels,
    refetchPinnedModels,
    refetchProviders,
    resetTags,
    resolvedSelectedModelIds,
    selectableModelsById,
    selectedTags,
    sortedProviders,
    tagSelection,
    togglePin,
    toggleTag,
    visibleSelectedModelIdSet
  }
}
