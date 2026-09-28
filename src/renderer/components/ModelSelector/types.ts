import type { ReactNode } from 'react'

import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CommandId } from '@shared/utils/command'

import type { ModelSelectorTag } from './filters'
import type { ModelPassiveReason } from './modelAvailability'

export type ModelSelectorSide = 'top' | 'right' | 'bottom' | 'left'
export type ModelSelectorAlign = 'start' | 'center' | 'end'
export type ModelSelectorSelectionType = 'model' | 'id'
export type ModelSelectorMountStrategy = 'destroy' | 'lazy-keep'
export type ModelSelectorFilter = (model: Model, provider?: Provider) => boolean

interface ModelSelectorCommonProps {
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  filter?: ModelSelectorFilter
  showTagFilter?: boolean
  showPinnedModels?: boolean
  showPinActions?: boolean
  /**
   * Also list models turned off in settings, demoted and badged rather than hidden. Only the chat
   * picker wants this — elsewhere offering a disabled model just lets it be chosen and then fail.
   */
  showDisabledModels?: boolean
  isModelDisabled?: ModelSelectorFilter
  includeAgentOnlyModels?: boolean
  prioritizedProviderIds?: readonly string[]
  side?: ModelSelectorSide
  align?: ModelSelectorAlign
  sideOffset?: number
  contentClassName?: string
  portalContainer?: HTMLElement | null
  mountStrategy?: ModelSelectorMountStrategy
  multiSelectMode?: boolean
  defaultMultiSelectMode?: boolean
  onMultiSelectModeChange?: (enabled: boolean) => void
  onSettingsNavigate?: (navigate: () => void) => void
  shortcut?: CommandId
}

export interface ModelSelectorSingleModelProps extends ModelSelectorCommonProps {
  // Required literal: making `multiple` optional would leave the discriminated
  // union undiscriminated (undefined satisfies every branch) and force every
  // downstream narrowing site to re-widen with an `as ModelSelectorValue` cast.
  multiple: false
  selectionType?: 'model'
  value?: Model
  noneOptionLabel?: string
  onSelect: (model: Model | undefined) => void
}

export interface ModelSelectorSingleIdProps extends ModelSelectorCommonProps {
  multiple: false
  selectionType: 'id'
  value?: UniqueModelId
  noneOptionLabel?: string
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
  groupKind: 'pinned' | 'provider'
  model: Model
  provider: Provider
  modelId: UniqueModelId
  modelIdentifier: string
  isPinned: boolean
  showIdentifier: boolean
  /** Set when the model is demoted: still selectable, but sorted last and badged. */
  passiveReason?: ModelPassiveReason
  /** Requests left across this provider's keys. Absent when no key declares a ceiling. */
  remainingQuota?: number
}

export type FlatListItem = ModelSelectorGroupItem | ModelSelectorModelItem

export interface UseModelSelectorDataOptions {
  enabled?: boolean
  includeAgentOnlyModels?: boolean
  selectedModelIds?: readonly UniqueModelId[]
  maxSelectedCount?: number
  searchText: string
  filter?: ModelSelectorFilter
  showTagFilter?: boolean
  showPinnedModels?: boolean
  showDisabledModels?: boolean
  prioritizedProviderIds?: readonly string[]
}

export interface UseModelSelectorDataResult {
  availableTags: ModelSelectorTag[]
  isLoading: boolean
  isPinActionDisabled: boolean
  listItems: FlatListItem[]
  modelItems: ModelSelectorModelItem[]
  pinnedIds: readonly UniqueModelId[]
  refetchModels: () => Promise<unknown>
  refetchPinnedModels: () => Promise<unknown>
  refetchProviders: () => Promise<unknown>
  resetTags: () => void
  resolvedSelectedModelIds: UniqueModelId[]
  selectableModelsById: ReadonlyMap<UniqueModelId, Model>
  selectedTags: ModelSelectorTag[]
  sortedProviders: Provider[]
  tagSelection: Record<ModelSelectorTag, boolean>
  togglePin: (modelId: UniqueModelId) => Promise<void>
  toggleTag: (tag: ModelSelectorTag) => void
  visibleSelectedModelIdSet: ReadonlySet<UniqueModelId>
}
