import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import { createContext, type ReactNode, use, useCallback, useSyncExternalStore } from 'react'

import type {
  ResourceListGroupStateSnapshot,
  ResourceListRowStateSnapshot,
  ResourceListUiService
} from './ResourceListUiService'

export type ResourceListItemBase = {
  id: string
  name: string
  description?: string
}

export type ResourceListStatus = 'idle' | 'loading' | 'error' | 'empty'

export type ResourceListRevealRequest = {
  clearFilters?: boolean
  clearQuery?: boolean
  itemId: string
  requestId: number
}

export type ResourceListGroup = {
  id: string
  label: string
  count?: number
}

export type ResourceListSection = {
  id: string
  label: string
  count?: number
}

export type ResourceListGroupSeed = ResourceListGroup & {
  section?: ResourceListSection | null
}

export type ResourceListGroupHeaderIconContext = {
  collapsed: boolean
}

export type ResourceListGroupHeaderClickBehavior = 'toggle' | 'select-first-then-toggle'

export type ResourceListSortOption<T extends ResourceListItemBase> = {
  id: string
  label: string
  comparator: (a: T, b: T) => number
}

export type ResourceListFilterOption<T extends ResourceListItemBase> = {
  id: string
  label: string
  predicate: (item: T) => boolean
}

export type ResourceListDragCapabilities = {
  groups?: boolean
  items?: boolean
  itemSameGroup?: boolean
  itemCrossGroup?: boolean
}

export type ResourceListItemReorderPayload = {
  type: 'item'
  activeId: string
  overId: string
  position: 'before' | 'after'
  overType: 'group' | 'item'
  sourceGroupId: string
  targetGroupId: string
  sourceIndex: number
  targetIndex: number
}

export type ResourceListGroupReorderPayload = {
  type: 'group'
  activeGroupId: string
  overGroupId: string
  overType: 'group' | 'item'
  sourceIndex: number
  targetIndex: number
}

export type ResourceListReorderPayload = ResourceListItemReorderPayload | ResourceListGroupReorderPayload

export type ResourceListVariantContext = {
  variant: 'session' | 'topic' | 'agent' | 'assistant' | 'history' | 'resource'
}

export type ResourceListState = {
  activeId: string | null
  query: string
  filters: string[]
  sort: string | null
  selectedId: string | null
  revealFocus: { itemId: string; requestId: number } | null
  renamingId: string | null
  collapsedGroups: string[]
  groupVisibleCounts: Record<string, number>
  draggingId: string | null
  status: ResourceListStatus
}

export type ResourceListActionMap = {
  setQuery: (query: string) => void
  setFilters: (filters: string[]) => void
  toggleFilter: (filterId: string) => void
  setSort: (sortId: string | null) => void
  setActiveItem: (id: string | null) => void
  selectItem: (id: string) => void
  startRename: (id: string) => void
  commitRename: (id: string, name: string) => void
  cancelRename: () => void
  openContextMenu: (id: string) => void
  selectGroupHeaderItem: (id: string) => void
  showMoreInGroup: (groupId: string) => void
  collapseGroupItems: (groupId: string) => void
  expandGroups: (groupIds: readonly string[]) => void
  collapseGroups: (groupIds: readonly string[]) => void
  toggleGroup: (groupId: string) => void
  reorder: (payload: ResourceListReorderPayload) => void
}

export type ResourceListMeta<T extends ResourceListItemBase> = {
  variant: ResourceListVariantContext['variant']
  getItemId: (item: T) => string
  getItemLabel: (item: T) => string
  groups: ResourceListGroup[]
  sections: ResourceListSection[]
  getSectionHeaderAction?: (section: ResourceListSection) => ReactNode
  getGroupHeaderAction?: (group: ResourceListGroup) => ReactNode
  getGroupHeaderContextMenu?: (group: ResourceListGroup) => readonly CommandContextMenuExtraItem[] | null | undefined
  getGroupHeaderLeadingAction?: (group: ResourceListGroup, context: ResourceListGroupHeaderIconContext) => ReactNode
  getGroupHeaderIcon?: (group: ResourceListGroup, context: ResourceListGroupHeaderIconContext) => ReactNode
  getGroupHeaderClassName?: (group: ResourceListGroup) => string | undefined
  getGroupHeaderTooltip?: (group: ResourceListGroup) => string | undefined
  getGroupHeaderClickBehavior: (group: ResourceListGroup) => ResourceListGroupHeaderClickBehavior
  onEmptyGroupHeaderClick?: (group: ResourceListGroup) => boolean | void
  sortOptions: ResourceListSortOption<T>[]
  filterOptions: ResourceListFilterOption<T>[]
  estimateItemSize: (index: number) => number
  defaultGroupVisibleCount: number
  groupLoadStep: number
  groupShowMoreLabel?: string
  groupCollapseLabel?: string
  revealRequest?: ResourceListRevealRequest
  dragCapabilities: ResourceListDragCapabilities
  canDragGroup?: (group: ResourceListGroup, groupIndex: number) => boolean
  canDragItem?: (args: {
    item: T
    itemIndex: number
    group: ResourceListGroup
    groupIndex: number
    itemIndexInGroup: number
  }) => boolean
  canDropGroup?: (args: {
    activeGroupId: string
    overGroupId: string
    overType: 'group' | 'item'
    sourceIndex: number
    targetIndex: number
  }) => boolean
  canDropItem?: (args: {
    activeId: string
    activeItem: T
    overId: string
    overItem?: T
    overType: 'group' | 'item'
    sourceGroup: ResourceListGroup
    sourceGroupId: string
    sourceIndex: number
    targetGroup: ResourceListGroup
    targetGroupId: string
    targetIndex: number
  }) => boolean
}

export type ResourceListViewGroup<T extends ResourceListItemBase> = {
  group: ResourceListGroup
  allItems: T[]
  items: T[]
  totalCount: number
  visibleCount: number
  hasMore: boolean
  canCollapseToDefault: boolean
  collapsed: boolean
}

export type ResourceListViewSection<T extends ResourceListItemBase> = {
  section: ResourceListSection
  groups: ResourceListViewGroup<T>[]
  allItems: T[]
  totalCount: number
  collapsed: boolean
}

export type ResourceListView<T extends ResourceListItemBase> = {
  items: T[]
  visibleItems: T[]
  groups: ResourceListViewGroup<T>[]
  sections: ResourceListViewSection<T>[]
}

export type ResourceListContextValue<T extends ResourceListItemBase> = {
  state: ResourceListState
  actions: ResourceListActionMap
  meta: ResourceListMeta<T>
  sourceItems: readonly T[]
  view: ResourceListView<T>
}

export type ResourceListControlsState = Pick<ResourceListState, 'filters' | 'query' | 'sort' | 'status'>

export type ResourceListItemAccessors<T extends ResourceListItemBase> = Pick<
  ResourceListMeta<T>,
  'getItemId' | 'getItemLabel'
>

export function getResourceListOptionDomId(itemId: string) {
  return `resource-list-option-${encodeURIComponent(itemId)}`
}

export const ResourceListContext = createContext<ResourceListContextValue<ResourceListItemBase> | null>(null)
export const ResourceListActionsContext = createContext<ResourceListActionMap | null>(null)
export const ResourceListControlsContext = createContext<ResourceListControlsState | null>(null)
export const ResourceListItemAccessorsContext = createContext<ResourceListItemAccessors<ResourceListItemBase> | null>(
  null
)
export const ResourceListMetaContext = createContext<ResourceListMeta<ResourceListItemBase> | null>(null)
export const ResourceListSourceItemsContext = createContext<readonly ResourceListItemBase[] | null>(null)
export const ResourceListUiStoreContext = createContext<ResourceListUiService | null>(null)
export const ResourceListViewContext = createContext<ResourceListView<ResourceListItemBase> | null>(null)

export function useResourceList<T extends ResourceListItemBase = ResourceListItemBase>() {
  const context = use(ResourceListContext)
  if (!context) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return context as unknown as ResourceListContextValue<T>
}

export function useResourceListActions() {
  const actions = use(ResourceListActionsContext)
  if (!actions) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return actions
}

export function useResourceListControlsState() {
  const controls = use(ResourceListControlsContext)
  if (!controls) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return controls
}

export function useResourceListItemAccessors<T extends ResourceListItemBase = ResourceListItemBase>() {
  const accessors = use(ResourceListItemAccessorsContext)
  if (!accessors) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return accessors as unknown as ResourceListItemAccessors<T>
}

export function useResourceListMeta<T extends ResourceListItemBase = ResourceListItemBase>() {
  const meta = use(ResourceListMetaContext)
  if (!meta) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return meta as unknown as ResourceListMeta<T>
}

export function useResourceListSourceItems<T extends ResourceListItemBase = ResourceListItemBase>() {
  const sourceItems = use(ResourceListSourceItemsContext)
  if (!sourceItems) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return sourceItems as readonly T[]
}

export function useResourceListUiStore() {
  const store = use(ResourceListUiStoreContext)
  if (!store) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return store
}

export function useResourceListView<T extends ResourceListItemBase = ResourceListItemBase>() {
  const view = use(ResourceListViewContext)
  if (!view) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return view as unknown as ResourceListView<T>
}

export function useResourceListRowState(itemId: string): ResourceListRowStateSnapshot {
  const store = useResourceListUiStore()
  const subscribe = useCallback((listener: () => void) => store.subscribeRow(itemId, listener), [itemId, store])
  const getSnapshot = useCallback(() => store.getRowSnapshot(itemId), [itemId, store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useResourceListGroupState(groupId: string): ResourceListGroupStateSnapshot {
  const store = useResourceListUiStore()
  const subscribe = useCallback((listener: () => void) => store.subscribeGroup(groupId, listener), [groupId, store])
  const getSnapshot = useCallback(() => store.getGroupSnapshot(groupId), [groupId, store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
