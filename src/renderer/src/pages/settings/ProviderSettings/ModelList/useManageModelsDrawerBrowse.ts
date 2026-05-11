import { loggerService } from '@logger'
import { groupQwenModels, isFreeModel } from '@renderer/config/models'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@shared/utils/model'
import { debounce, groupBy, uniqBy } from 'lodash'
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'

import { normalizeModelGroupName } from './grouping'
import { fetchResolvedProviderModels } from './modelSync'
import { filterProviderSettingModelsByKeywords } from './utils'

const logger = loggerService.withContext('useManageModelsDrawerBrowse')

export interface UseManageModelsDrawerBrowseArgs {
  open: boolean
  providerId: string
  provider: Provider | undefined
  existingModels: Model[]
}

/**
 * Catalog fetch + search/filter + grouping for the manage-models drawer.
 * Mutations / inline custom-add stay in `ManageModelsDrawer` (command surface).
 */
export function useManageModelsDrawerBrowse({
  open,
  providerId,
  provider,
  existingModels
}: UseManageModelsDrawerBrowseArgs) {
  const [listModels, setListModels] = useState<Model[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filterSearchText, setFilterSearchText] = useState('')
  const [actualFilterType, setActualFilterType] = useState<string>('all')
  const [optimisticFilterType, setOptimisticFilterType] = useOptimistic(
    actualFilterType,
    (_current, next: string) => next
  )
  const [isSearchPending, startSearchTransition] = useTransition()
  const [isFilterTypePending, startFilterTypeTransition] = useTransition()
  const [isStatusPending, startStatusTransition] = useTransition()
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [optimisticStatusFilter, setOptimisticStatusFilter] = useOptimistic(
    statusFilter,
    (_c, next: 'all' | 'enabled' | 'disabled') => next
  )

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const debouncedSetFilterText = useMemo(
    () =>
      debounce((value: string) => {
        startSearchTransition(() => {
          setFilterSearchText(value)
        })
      }, 300),
    [startSearchTransition]
  )

  useEffect(() => {
    return () => {
      debouncedSetFilterText.cancel()
    }
  }, [debouncedSetFilterText])

  const existingModelIds = useMemo(() => new Set<string>(existingModels.map((m) => m.id)), [existingModels])
  const existingById = useMemo(() => new Map(existingModels.map((m) => [m.id, m] as const)), [existingModels])

  const allModels = useMemo(() => uniqBy([...listModels, ...existingModels], 'id'), [existingModels, listModels])

  const capabilityFiltered = useMemo(
    () =>
      filterProviderSettingModelsByKeywords(filterSearchText, allModels).filter((model) => {
        switch (actualFilterType) {
          case 'reasoning':
            return isReasoningModel(model)
          case 'vision':
            return isVisionModel(model)
          case 'websearch':
            return isWebSearchModel(model)
          case 'free':
            return isFreeModel(model)
          case 'embedding':
            return isEmbeddingModel(model)
          case 'function_calling':
            return isFunctionCallingModel(model)
          case 'rerank':
            return isRerankModel(model)
          default:
            return true
        }
      }),
    [actualFilterType, allModels, filterSearchText]
  )

  const list = useMemo(() => {
    return capabilityFiltered.filter((model) => {
      const inProvider = existingModelIds.has(model.id)
      const enabled = inProvider ? (existingById.get(model.id)?.isEnabled ?? true) : false
      switch (statusFilter) {
        case 'enabled':
          return inProvider && enabled
        case 'disabled':
          return !inProvider || !enabled
        default:
          return true
      }
    })
  }, [capabilityFiltered, existingById, existingModelIds, statusFilter])

  const modelGroups: Record<string, Model[]> = useMemo(() => {
    const groupFn = (model: Model) => normalizeModelGroupName(model.group, provider?.id)
    if (provider?.id === 'dashscope') {
      const isQwen = (model: Model) => parseUniqueModelId(model.id).modelId.startsWith('qwen')
      const qwenModels = list.filter(isQwen)
      const nonQwenModels = list.filter((model) => !isQwen(model))
      return {
        ...groupBy(nonQwenModels, groupFn),
        ...groupQwenModels(qwenModels)
      }
    }

    return groupBy(list, groupFn)
  }, [list, provider?.id])

  const browseLoading = loadingModels || isSearchPending || isFilterTypePending || isStatusPending

  const loadModels = useCallback(
    async (currentProvider: Provider) => {
      setLoadingModels(true)
      try {
        setListModels(await fetchResolvedProviderModels(providerId, currentProvider))
      } catch (error) {
        logger.error(`Failed to load models for provider ${getFancyProviderName(currentProvider)}`, error as Error)
      } finally {
        setLoadingModels(false)
      }
    },
    [providerId]
  )

  useEffect(() => {
    if (!open || !provider) {
      return
    }
    void loadModels(provider)
  }, [loadModels, open, provider])

  useEffect(() => {
    if (!open) {
      setStatusFilter('all')
      return
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 100)

    return () => window.clearTimeout(timer)
  }, [open])

  const onSearchInputChange = useCallback(
    (nextValue: string) => {
      setSearchText(nextValue)
      debouncedSetFilterText(nextValue)
    },
    [debouncedSetFilterText]
  )

  const setStatusFilterKey = useCallback(
    (key: 'all' | 'enabled' | 'disabled') => {
      setOptimisticStatusFilter(key)
      startStatusTransition(() => {
        setStatusFilter(key)
      })
    },
    [setOptimisticStatusFilter, startStatusTransition]
  )

  const setCapabilityFilterKey = useCallback(
    (key: string) => {
      setOptimisticFilterType(key)
      startFilterTypeTransition(() => {
        setActualFilterType(key)
      })
    },
    [setOptimisticFilterType, startFilterTypeTransition]
  )

  return {
    listModels,
    loadingModels,
    loadModels,
    searchText,
    searchInputRef,
    onSearchInputChange,
    optimisticStatusFilter,
    setStatusFilterKey,
    optimisticFilterType,
    setCapabilityFilterKey,
    modelGroups,
    existingModelIds,
    existingById,
    list,
    browseLoading
  }
}
