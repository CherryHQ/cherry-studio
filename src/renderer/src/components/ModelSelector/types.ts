import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReactNode } from 'react'

import type { ModelSelectorTag } from './filters'

export type ModelSelectorSide = 'top' | 'right' | 'bottom' | 'left'
export type ModelSelectorAlign = 'start' | 'center' | 'end'
export type ModelSelectorSelectionType = 'model' | 'id'

interface ModelSelectorCommonProps {
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  filter?: (model: Model) => boolean
  showTagFilter?: boolean
  showPinnedModels?: boolean
  prioritizedProviderIds?: string[]
  side?: ModelSelectorSide
  align?: ModelSelectorAlign
  sideOffset?: number
  contentClassName?: string
  multiSelectMode?: boolean
  defaultMultiSelectMode?: boolean
  onMultiSelectModeChange?: (enabled: boolean) => void
}

export interface ModelSelectorSingleModelProps extends ModelSelectorCommonProps {
  // Required literal: making `multiple` optional would leave the discriminated
  // union undiscriminated (undefined satisfies every branch) and force every
  // downstream narrowing site to re-widen with an `as ModelSelectorValue` cast.
  multiple: false
  selectionType?: 'model'
  value?: Model
  onSelect: (model: Model | undefined) => void
}

export interface ModelSelectorSingleIdProps extends ModelSelectorCommonProps {
  multiple: false
  selectionType: 'id'
  value?: UniqueModelId
  onSelect: (modelId: UniqueModelId | undefined) => void
}

export interface ModelSelectorMultiModelProps extends ModelSelectorCommonProps {
  multiple: true
  selectionType?: 'model'
  value?: Model[]
  onSelect: (models: Model[]) => void
}

export interface ModelSelectorMultiIdProps extends ModelSelectorCommonProps {
  multiple: true
  selectionType: 'id'
  value?: UniqueModelId[]
  onSelect: (modelIds: UniqueModelId[]) => void
}

export type ModelSelectorProps =
  | ModelSelectorSingleModelProps
  | ModelSelectorSingleIdProps
  | ModelSelectorMultiModelProps
  | ModelSelectorMultiIdProps

export interface ModelSelectorGroupItem {
  key: string
  type: 'group'
  title: string
  groupKind: 'pinned' | 'provider'
  provider?: Provider
  canNavigateToSettings?: boolean
}

export interface ModelSelectorModelItem {
  key: string
  type: 'model'
  model: Model
  provider: Provider
  modelId: UniqueModelId
  modelIdentifier: string
  isPinned: boolean
  isSelected: boolean
  showIdentifier: boolean
}

export type FlatListItem = ModelSelectorGroupItem | ModelSelectorModelItem

export interface UseModelSelectorDataOptions {
  selectedModelIds?: readonly UniqueModelId[]
  maxSelectedCount?: number
  searchText: string
  filter?: (model: Model) => boolean
  showTagFilter?: boolean
  showPinnedModels?: boolean
  prioritizedProviderIds?: string[]
}

export interface UseModelSelectorDataResult {
  availableTags: ModelSelectorTag[]
  isLoading: boolean
  isPinActionDisabled: boolean
  listItems: FlatListItem[]
  modelItems: ModelSelectorModelItem[]
  pinnedIds: readonly UniqueModelId[]
  refetchPinnedModels: () => Promise<unknown>
  resetTags: () => void
  resolvedSelectedModelIds: UniqueModelId[]
  selectableModelsById: ReadonlyMap<UniqueModelId, Model>
  selectedTags: ModelSelectorTag[]
  sortedProviders: Provider[]
  tagSelection: Record<ModelSelectorTag, boolean>
  togglePin: (modelId: UniqueModelId) => Promise<void>
  toggleTag: (tag: ModelSelectorTag) => void
}
