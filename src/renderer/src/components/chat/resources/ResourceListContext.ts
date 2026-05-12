import { createContext, type ReactNode, use } from 'react'

export type ResourceListItemBase = {
  id: string
  name: string
  description?: string
}

export type ResourceListStatus = 'idle' | 'loading' | 'error' | 'empty'

export type ResourceListGroup = {
  id: string
  label: string
  count?: number
}

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

export type ResourceListReorderPayload = {
  activeId: string
  overId: string
  position: 'before' | 'after'
}

export type ResourceListVariantContext = {
  variant: 'session' | 'topic' | 'agent' | 'assistant' | 'history' | 'resource'
}

export type ResourceListState = {
  query: string
  filters: string[]
  sort: string | null
  selectedId: string | null
  hoveredId: string | null
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
  selectItem: (id: string) => void
  hoverItem: (id: string | null) => void
  startRename: (id: string) => void
  commitRename: (id: string, name: string) => void
  cancelRename: () => void
  openContextMenu: (id: string) => void
  showMoreInGroup: (groupId: string) => void
  collapseGroupItems: (groupId: string) => void
  toggleGroup: (groupId: string) => void
  reorder: (payload: ResourceListReorderPayload) => void
}

export type ResourceListMeta<T extends ResourceListItemBase> = {
  variant: ResourceListVariantContext['variant']
  getItemId: (item: T) => string
  getItemLabel: (item: T) => string
  groups: ResourceListGroup[]
  getGroupHeaderAction?: (group: ResourceListGroup) => ReactNode
  getGroupHeaderIcon?: (group: ResourceListGroup) => ReactNode
  sortOptions: ResourceListSortOption<T>[]
  filterOptions: ResourceListFilterOption<T>[]
  estimateItemSize: (index: number) => number
  defaultGroupVisibleCount: number
  groupLoadStep: number
  groupShowMoreLabel?: string
  groupCollapseLabel?: string
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

export type ResourceListView<T extends ResourceListItemBase> = {
  items: T[]
  visibleItems: T[]
  groups: ResourceListViewGroup<T>[]
}

export type ResourceListContextValue<T extends ResourceListItemBase> = {
  state: ResourceListState
  actions: ResourceListActionMap
  meta: ResourceListMeta<T>
  sourceItems: readonly T[]
  view: ResourceListView<T>
}

export const ResourceListContext = createContext<ResourceListContextValue<ResourceListItemBase> | null>(null)

export function useResourceList<T extends ResourceListItemBase = ResourceListItemBase>() {
  const context = use(ResourceListContext)
  if (!context) {
    throw new Error('ResourceList compound components must be rendered inside ResourceList.Provider')
  }
  return context as unknown as ResourceListContextValue<T>
}
