import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { Model } from '@shared/data/types/model'
import {
  isEmbeddingModel,
  isFreeModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@shared/utils/model'
import { sortBy, toPairs } from 'lodash'

import { normalizeModelGroupName } from './grouping'
import { filterProviderSettingModelsByKeywords, getDuplicateProviderSettingModelNames } from './utils'

export type ModelGroups = Record<string, Model[]>

export type ModelSections = {
  enabled: ModelGroups
  disabled: ModelGroups
}

export const MODEL_LIST_CAPABILITY_FILTERS = [
  'all',
  'reasoning',
  'vision',
  'websearch',
  'free',
  'embedding',
  'rerank',
  'function_calling'
] as const

export type ModelListCapabilityFilter = (typeof MODEL_LIST_CAPABILITY_FILTERS)[number]
export type ModelListCapabilityCounts = Record<ModelListCapabilityFilter, number>

export type ModelListDerivedState = {
  filteredModels: Model[]
  sections: ModelSections
  capabilityOptions: readonly ModelListCapabilityFilter[]
  capabilityModelCounts: ModelListCapabilityCounts
  duplicateModelNames: Set<string>
  enabledModelCount: number
  disabledModelCount: number
  modelCount: number
  hasVisibleModels: boolean
  hasNoModels: boolean
  allEnabled: boolean
  modelStatusMap: Map<string, ModelWithStatus>
}

export const MODEL_COUNT_THRESHOLD = 10

type CalculateModelListDerivedStateInput = {
  models: Model[]
  searchText: string
  selectedCapabilityFilter: ModelListCapabilityFilter
  modelStatuses: ModelWithStatus[]
}

export const groupModels = (models: Model[]): ModelGroups => {
  const grouped = models.reduce<ModelGroups>((acc, model) => {
    const groupName = normalizeModelGroupName(model.group)
    if (!acc[groupName]) {
      acc[groupName] = []
    }
    acc[groupName].push(model)
    return acc
  }, {})

  return sortBy(toPairs(grouped), [0]).reduce((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {} as ModelGroups)
}

export const matchesCapabilityFilter = (model: Model, selectedCapabilityFilter: ModelListCapabilityFilter): boolean => {
  switch (selectedCapabilityFilter) {
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
    case 'rerank':
      return isRerankModel(model)
    case 'function_calling':
      return isFunctionCallingModel(model)
    default:
      return true
  }
}

export const applyModelFilters = (
  models: Model[],
  searchText: string,
  selectedCapabilityFilter: ModelListCapabilityFilter
): Model[] => {
  const searchedModels = searchText ? filterProviderSettingModelsByKeywords(searchText, models) : models
  if (selectedCapabilityFilter === 'all') {
    return searchedModels
  }

  return searchedModels.filter((model) => matchesCapabilityFilter(model, selectedCapabilityFilter))
}

export const calculateModelSections = (
  models: Model[],
  searchText: string,
  selectedCapabilityFilter: ModelListCapabilityFilter
): ModelSections => {
  const filteredModels = applyModelFilters(models, searchText, selectedCapabilityFilter)

  return {
    enabled: groupModels(filteredModels.filter((model) => model.isEnabled)),
    disabled: groupModels(filteredModels.filter((model) => !model.isEnabled))
  }
}

export const countModelsInGroups = (groups: ModelGroups): number => {
  return Object.values(groups).reduce((acc, group) => acc + group.length, 0)
}

export const getCapabilityModelCounts = (models: Model[]): ModelListCapabilityCounts => {
  const counts = Object.fromEntries(
    MODEL_LIST_CAPABILITY_FILTERS.map((filter) => [filter, 0])
  ) as ModelListCapabilityCounts
  counts.all = models.length

  for (const model of models) {
    if (isReasoningModel(model)) {
      counts.reasoning += 1
    }
    if (isVisionModel(model)) {
      counts.vision += 1
    }
    if (isWebSearchModel(model)) {
      counts.websearch += 1
    }
    if (isFreeModel(model)) {
      counts.free += 1
    }
    if (isEmbeddingModel(model)) {
      counts.embedding += 1
    }
    if (isRerankModel(model)) {
      counts.rerank += 1
    }
    if (isFunctionCallingModel(model)) {
      counts.function_calling += 1
    }
  }

  return counts
}

export const calculateModelListDerivedState = ({
  models,
  searchText,
  selectedCapabilityFilter,
  modelStatuses
}: CalculateModelListDerivedStateInput): ModelListDerivedState => {
  const filteredModels = applyModelFilters(models, searchText, selectedCapabilityFilter)
  const enabledModelCount = filteredModels.filter((model) => model.isEnabled).length

  return {
    filteredModels,
    sections: {
      enabled: groupModels(filteredModels.filter((model) => model.isEnabled)),
      disabled: groupModels(filteredModels.filter((model) => !model.isEnabled))
    },
    capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
    capabilityModelCounts: getCapabilityModelCounts(models),
    duplicateModelNames: getDuplicateProviderSettingModelNames(models),
    enabledModelCount,
    disabledModelCount: filteredModels.length - enabledModelCount,
    modelCount: filteredModels.length,
    hasVisibleModels: filteredModels.length > 0,
    hasNoModels: models.length === 0,
    allEnabled: filteredModels.length > 0 && filteredModels.every((model) => model.isEnabled),
    modelStatusMap: new Map(modelStatuses.map((status) => [status.model.id, status]))
  }
}
