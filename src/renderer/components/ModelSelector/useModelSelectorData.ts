import { sortBy } from 'es-toolkit/compat'
import { useCallback, useMemo } from 'react'

import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { modelMatchesDisplayTag } from '@renderer/components/tags/Model'
import { useModels } from '@renderer/hooks/useModel'
import { usePins } from '@renderer/hooks/usePins'
import { useProviders } from '@renderer/hooks/useProvider'
import { getAppEdition } from '@renderer/utils/appEdition'
import { getSearchMatchScore } from '@renderer/utils/model'
import { isProviderSettingsListVisibleProvider } from '@renderer/utils/providerSettings'
import { AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT } from '@shared/data/api/schemas/aiUsageRecords'
import type { ApiKeyLimitPeriod } from '@shared/data/preference/preferenceTypes'
import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { collectKeyUsage, periodStartOf, usageStatsFrom } from '@shared/utils/apiKeyLimit'
import { isAgentOnlyProvider } from '@shared/utils/provider'

import { MODEL_SELECTOR_TAGS, type ModelSelectorTag, useModelTagFilter } from './filters'
import {
  getModelPassiveReason,
  getRemainingQuota,
  isQuotaExhausted,
  type ModelPassiveReason,
  passiveSortRank
} from './modelAvailability'
import type {
  FlatListItem,
  ModelSelectorModelItem,
  UseModelSelectorDataOptions,
  UseModelSelectorDataResult
} from './types'
import { getProviderDisplayName } from './utils'

const EMPTY_TAGS: ModelSelectorTag[] = []
const CHERRYAI_DISPLAY_GROUP = {
  id: CHERRYAI_PROVIDER_ID,
  providerIds: [CHERRYAI_PROVIDER_ID, CHERRY_CLOUD_PROVIDER_ID]
} as const

interface ModelSelectorDisplayGroup {
  id: string
  provider: Provider
  models: Array<{ model: Model; provider: Provider }>
}

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

function sortModels(models: Model[], passiveRank: (model: Model) => number) {
  return sortBy(models, [passiveRank, 'group', 'name'])
}

function getModelIdentifier(model: Model) {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

function getDisplayGroupId(providerId: string) {
  return CHERRYAI_DISPLAY_GROUP.providerIds.some((id) => id === providerId) ? CHERRYAI_DISPLAY_GROUP.id : providerId
}

function sortProvidersByPriority(providers: Provider[], prioritizedProviderIds: readonly string[]) {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const prioritized = [...new Set([...CHERRYAI_DISPLAY_GROUP.providerIds, ...prioritizedProviderIds])]
    .map((providerId) => providerById.get(providerId))
    .filter((provider): provider is Provider => Boolean(provider))
  const prioritizedIds = new Set(prioritized.map((provider) => provider.id))
  const remaining = providers.filter((provider) => !prioritizedIds.has(provider.id))

  return [...prioritized, ...remaining]
}

export function useModelSelectorData({
  enabled = true,
  includeAgentOnlyModels = false,
  selectedModelIds = [],
  maxSelectedCount,
  searchText,
  filter,
  showTagFilter = true,
  showPinnedModels = true,
  showDisabledModels = false,
  prioritizedProviderIds = []
}: UseModelSelectorDataOptions): UseModelSelectorDataResult {
  const {
    providers,
    isLoading: isProvidersLoading,
    refetch: refetchProviders
  } = useProviders({ enabled: true }, { enabled })
  // With `showDisabledModels`, a model turned off after a failed health check stays visible —
  // demoted and badged rather than hidden — so it can still be seen and picked from here.
  const {
    models,
    isLoading: isModelsLoading,
    refetch: refetchModels
  } = useModels(showDisabledModels ? undefined : { enabled: true }, { fetchEnabled: enabled })
  const {
    isLoading: isPinsLoading,
    isRefreshing: isPinsRefreshing,
    isMutating: isPinsMutating,
    pinnedIds: rawPinnedIds,
    refetch: refetchPinnedModels,
    togglePin
  } = usePins('model', { enabled })
  const { tagSelection, selectedTags, tagFilter, toggleTag, resetTags } = useModelTagFilter()
  const pinnedIds = useMemo(() => rawPinnedIds.filter(isUniqueModelId), [rawPinnedIds])
  const [modelHealth] = usePreference('chat.retry.model_health')
  const [apiKeyLimits] = usePreference('chat.routing.api_key_limits')

  const quotaPeriods = useMemo(() => {
    if (!apiKeyLimits || Object.keys(apiKeyLimits).length === 0) return []
    const periods = new Set<ApiKeyLimitPeriod>()
    for (const v of Object.values(apiKeyLimits)) periods.add(v.period)
    return [...periods]
  }, [apiKeyLimits])

  const quotaStatsParams = useMemo(() => {
    // `useQuery` treats absent options as enabled, so skipping has to be said explicitly — passing
    // `undefined` sent a query-less request that the endpoint rejects, once per picker render.
    if (quotaPeriods.length === 0) return { enabled: false }
    const minFrom = usageStatsFrom(quotaPeriods.map((p) => periodStartOf(p)))
    return {
      query: {
        groupBy: 'apiKeyModel' as const,
        metric: 'requests' as const,
        from: minFrom,
        to: Date.now(),
        limit: AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT
      }
    }
  }, [quotaPeriods])

  const { data: quotaUsageData } = useQuery('/ai-usage-records/stats', quotaStatsParams)

  const quotaUsageCounts = useMemo(() => {
    // Every ModelSelector in the app runs this, so a stats payload without buckets must degrade to
    // "usage unknown" rather than throw and take the whole picker down with it.
    if (!Array.isArray(quotaUsageData?.buckets)) return undefined
    return collectKeyUsage(quotaUsageData.buckets, quotaUsageData.other)
  }, [quotaUsageData])

  const quotaExhaustedModelIds = useMemo(() => {
    if (!apiKeyLimits || Object.keys(apiKeyLimits).length === 0) return new Set<string>()
    const exhausted = new Set<string>()
    const providerById = new Map(providers.map((p) => [p.id, p]))

    for (const model of models) {
      const provider = providerById.get(model.providerId)
      if (!provider) continue
      if (isQuotaExhausted(provider, model.id, apiKeyLimits, quotaUsageCounts)) {
        exhausted.add(model.id)
      }
    }
    return exhausted
  }, [apiKeyLimits, providers, models, quotaUsageCounts])

  // What is left on each model, so searching one model name shows how much room each provider
  // serving it actually has — the user should not have to remember which account still had some.
  const remainingQuotaByModelId = useMemo(() => {
    const remaining = new Map<UniqueModelId, number>()
    if (!apiKeyLimits || Object.keys(apiKeyLimits).length === 0) return remaining
    const providerById = new Map(providers.map((p) => [p.id, p]))

    for (const model of models) {
      const provider = providerById.get(model.providerId)
      if (!provider) continue
      const left = getRemainingQuota(provider, model.id, apiKeyLimits, quotaUsageCounts)
      if (left !== undefined) remaining.set(model.id, left)
    }
    return remaining
  }, [apiKeyLimits, providers, models, quotaUsageCounts])

  const passiveReasonByModelId = useMemo(() => {
    const providerById = new Map(providers.map((provider) => [provider.id, provider]))
    const reasons = new Map<UniqueModelId, ModelPassiveReason>()

    for (const model of models) {
      const provider = providerById.get(model.providerId)
      if (!provider) continue

      const reason = getModelPassiveReason(model, provider, modelHealth, quotaExhaustedModelIds)
      if (reason) reasons.set(model.id, reason)
    }

    return reasons
  }, [models, providers, modelHealth, quotaExhaustedModelIds])

  const passiveRank = useCallback(
    (model: Model) => passiveSortRank(passiveReasonByModelId.get(model.id)),
    [passiveReasonByModelId]
  )

  const baseModelFilter = useCallback(
    (model: Model, provider?: Provider) => filter?.(model, provider) ?? true,
    [filter]
  )

  const agentOnlyProviderIds = useMemo(() => {
    const edition = getAppEdition()
    return new Set(
      providers.filter((provider) => isAgentOnlyProvider(provider, edition)).map((provider) => provider.id)
    )
  }, [providers])

  const sortedProviders = useMemo(
    () => sortProvidersByPriority(providers, prioritizedProviderIds),
    [prioritizedProviderIds, providers]
  )

  // 交叉过滤：Provider.isEnabled 与 Model.isEnabled 互不联动，禁用 provider 下可能仍有启用 model。
  // 这里必须剔除孤儿 model，保证每条 model 都能找到对应分组。
  const modelsByProvider = useMemo(() => {
    const providerById = new Map(sortedProviders.map((provider) => [provider.id, provider]))
    const grouped = new Map<string, Model[]>()

    for (const model of models) {
      const provider = providerById.get(model.providerId)
      if (!provider || !baseModelFilter(model, provider)) {
        continue
      }

      if (!includeAgentOnlyModels && agentOnlyProviderIds.has(model.providerId)) {
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
  }, [agentOnlyProviderIds, baseModelFilter, includeAgentOnlyModels, models, sortedProviders])

  const availableTags = useMemo(() => {
    if (modelsByProvider.size === 0) {
      return EMPTY_TAGS
    }

    return MODEL_SELECTOR_TAGS.filter((tag) =>
      sortedProviders.some((provider) =>
        (modelsByProvider.get(provider.id) ?? []).some((model) => modelMatchesDisplayTag(model, tag, provider))
      )
    )
  }, [modelsByProvider, sortedProviders])

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
          [({ model }) => passiveRank(model), 'searchScore', 'model.group', 'model.name']
        ).map(({ model }) => model)
      }

      return sortModels(providerModels, passiveRank)
    },
    [modelsByProvider, searchText, passiveRank]
  )

  const createModelItem = useCallback(
    (
      model: Model,
      provider: Provider,
      groupKind: ModelSelectorModelItem['groupKind'],
      isPinned: boolean,
      showIdentifier: boolean
    ): ModelSelectorModelItem => {
      const modelId = model.id

      return {
        key: groupKind === 'pinned' ? `${modelId}_pinned` : modelId,
        type: 'model',
        groupKind,
        model,
        provider,
        modelId,
        modelIdentifier: getModelIdentifier(model),
        isPinned,
        showIdentifier,
        ...(passiveReasonByModelId.has(modelId) && { passiveReason: passiveReasonByModelId.get(modelId) }),
        ...(remainingQuotaByModelId.has(modelId) && { remainingQuota: remainingQuotaByModelId.get(modelId) })
      }
    },
    [passiveReasonByModelId, remainingQuotaByModelId]
  )

  const { listItems, modelItems } = useMemo(() => {
    const items: FlatListItem[] = []
    const pinnedIdSet = new Set(pinnedIds)
    const providerById = new Map(sortedProviders.map((provider) => [provider.id, provider]))
    const finalModelFilter = (model: Model) => {
      const provider = providerById.get(model.providerId)
      return (!showTagFilter || tagFilter(model, provider)) && baseModelFilter(model, provider)
    }
    // `searchFilter(provider)` runs fuzzy scoring + sort per provider; cache the tag-filtered
    // result so display-group duplicate-name detection and the list below share one pass.
    const tagFilteredModelsByProvider = new Map<string, Model[]>(
      sortedProviders.map((provider) => [
        provider.id,
        searchFilter(provider).filter((model) => (!showTagFilter ? true : tagFilter(model, provider)))
      ])
    )
    const displayGroupsById = new Map<string, ModelSelectorDisplayGroup>()
    for (const provider of sortedProviders) {
      const providerModels = tagFilteredModelsByProvider.get(provider.id) ?? []
      if (providerModels.length === 0) {
        continue
      }

      const groupId = getDisplayGroupId(provider.id)
      const group = displayGroupsById.get(groupId)
      const modelsWithProvider = providerModels.map((model) => ({ model, provider }))

      if (group) {
        group.models.push(...modelsWithProvider)
      } else {
        displayGroupsById.set(groupId, { id: groupId, provider, models: modelsWithProvider })
      }
    }
    // A provider whose every model is passive sinks below the usable ones, so a permanently
    // unusable group (managed CherryAI) cannot hold the prioritized top slot.
    const displayGroups = sortBy(
      [...displayGroupsById.values()],
      [(group) => (group.models.every(({ model }) => passiveReasonByModelId.has(model.id)) ? 1 : 0)]
    )
    const duplicateModelNamesByDisplayGroup = new Map(
      displayGroups.map((group) => [group.id, getDuplicateModelNames(group.models.map(({ model }) => model))])
    )

    if (searchText.length === 0 && showPinnedModels && pinnedIdSet.size > 0) {
      const pinnedItems = pinnedIds.flatMap((modelId) => {
        const model = selectableModelsById.get(modelId)
        const provider = model ? providerById.get(model.providerId) : undefined
        if (!model || !provider || !finalModelFilter(model)) {
          return []
        }

        return [
          createModelItem(
            model,
            provider,
            'pinned',
            true,
            duplicateModelNamesByDisplayGroup.get(getDisplayGroupId(provider.id))?.has(model.name) ?? false
          )
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

    displayGroups.forEach((group) => {
      const filteredModels = group.models.filter(
        ({ model }) => !showPinnedModels || searchText.length > 0 || !pinnedIdSet.has(model.id)
      )

      if (filteredModels.length === 0) {
        return
      }

      items.push({
        key: `provider-${group.id}`,
        type: 'group',
        title: getProviderDisplayName(group.provider),
        groupKind: 'provider',
        provider: group.provider,
        canNavigateToSettings: isProviderSettingsListVisibleProvider(group.provider)
      })

      items.push(
        ...filteredModels.map(({ model, provider }) =>
          createModelItem(
            model,
            provider,
            'provider',
            showPinnedModels && pinnedIdSet.has(model.id),
            duplicateModelNamesByDisplayGroup.get(group.id)?.has(model.name) ?? false
          )
        )
      )
    })

    const selectableModelItems = items.filter((item): item is ModelSelectorModelItem => item.type === 'model')
    return { listItems: items, modelItems: selectableModelItems }
  }, [
    baseModelFilter,
    createModelItem,
    passiveReasonByModelId,
    pinnedIds,
    searchFilter,
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
