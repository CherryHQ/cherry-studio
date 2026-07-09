import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import {
  isEmbeddingModel,
  isFreeModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@shared/utils/model'
import { sortBy, toPairs } from 'es-toolkit/compat'

import { normalizeModelGroupName } from './grouping'
import { filterProviderSettingModelsByKeywords, getDuplicateProviderSettingModelNames } from './utils'

export type ModelGroups = Record<string, Model[]>
interface GroupModelsOptions {
  preferModelGroup?: boolean
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
  capabilityOptions: readonly ModelListCapabilityFilter[]
  capabilityModelCounts: ModelListCapabilityCounts
  duplicateModelNames: Set<string>
  modelCount: number
  hasVisibleModels: boolean
  hasNoModels: boolean
  modelStatusMap: Map<string, ModelWithStatus>
}

export const MODEL_COUNT_THRESHOLD = 10

type CalculateModelListDerivedStateInput = {
  models: Model[]
  searchText: string
  selectedCapabilityFilter: ModelListCapabilityFilter
  modelStatuses: ModelWithStatus[]
}

function getModelIdGroupName(model: Model): string | undefined {
  const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
  const pathParts = modelId.split('/')
  if (pathParts.length > 1) {
    return pathParts[0]
  }

  const familyName = modelId.split('-')[0]?.trim()
  return familyName !== modelId ? familyName : undefined
}

export const groupModels = (
  models: Model[],
  preserveGroupOrder = false,
  options: GroupModelsOptions = {}
): ModelGroups => {
  const grouped = models.reduce<ModelGroups>((acc, model) => {
    const preferredGroup = options.preferModelGroup ? model.group : getModelIdGroupName(model)
    const fallbackGroup = options.preferModelGroup ? getModelIdGroupName(model) : model.group
    const groupName = normalizeModelGroupName(preferredGroup, fallbackGroup ?? model.providerId)
    if (!acc[groupName]) {
      acc[groupName] = []
    }
    acc[groupName].push(model)
    return acc
  }, {})

  if (preserveGroupOrder) {
    return grouped
  }

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

  return {
    filteredModels,
    capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
    capabilityModelCounts: getCapabilityModelCounts(models),
    duplicateModelNames: getDuplicateProviderSettingModelNames(models),
    modelCount: filteredModels.length,
    hasVisibleModels: filteredModels.length > 0,
    hasNoModels: models.length === 0,
    modelStatusMap: new Map(modelStatuses.map((status) => [status.model.id, status]))
  }
}
