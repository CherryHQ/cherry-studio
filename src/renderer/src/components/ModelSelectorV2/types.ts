import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReactNode } from 'react'

import type { ModelSelectorTag } from './filters'

export type ModelSelectorSide = 'top' | 'right' | 'bottom' | 'left'
export type ModelSelectorAlign = 'start' | 'center' | 'end'

export interface ModelSelectorProps {
  value?: Model
  onSelect: (model: Model) => void
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
}

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
  value?: Model
  searchText: string
  filter?: (model: Model) => boolean
  showTagFilter?: boolean
  showPinnedModels?: boolean
  prioritizedProviderIds?: string[]
}

export interface UseModelSelectorDataResult {
  availableTags: ModelSelectorTag[]
  currentModelId: string
  isLoading: boolean
  listItems: FlatListItem[]
  modelItems: ModelSelectorModelItem[]
  pinnedIds: string[]
  resetTags: () => void
  selectedTags: ModelSelectorTag[]
  sortedProviders: Provider[]
  tagSelection: Record<ModelSelectorTag, boolean>
  togglePin: (modelId: UniqueModelId) => Promise<void>
  toggleTag: (tag: ModelSelectorTag) => void
}
