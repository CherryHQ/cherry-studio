import {
  Button,
  ContextMenu as UiContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator as UiContextMenuSeparator,
  ContextMenuSubContent as UiContextMenuSubContent,
  ContextMenuSubTrigger as UiContextMenuSubTrigger,
  ContextMenuTrigger,
  EmptyState as UiEmptyState,
  Input,
  Skeleton
} from '@cherrystudio/ui'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@renderer/utils/style'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CalendarDays, ChevronsDown, ChevronsUp, SearchIcon } from 'lucide-react'
import type { ComponentProps, CSSProperties, ReactNode, Ref } from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import {
  ResourceListContext,
  type ResourceListContextValue,
  type ResourceListFilterOption,
  type ResourceListGroup,
  type ResourceListItemBase,
  type ResourceListReorderPayload,
  type ResourceListSortOption,
  type ResourceListState,
  type ResourceListStatus,
  type ResourceListVariantContext,
  useResourceList
} from './ResourceListContext'

const DEFAULT_GROUP_SHOW_MORE_LABEL = 'Show more'
const DEFAULT_GROUP_COLLAPSE_LABEL = 'Collapse group'
const SCROLLBAR_AUTO_HIDE_DELAY = 1200
const SCROLLBAR_FADE_STEP = 140
const CONTEXT_MENU_CONTENT_CLASS = 'w-[184px] rounded-lg border-border/80 p-1.5 shadow-lg'
const CONTEXT_MENU_ITEM_CLASS =
  'h-7 gap-2 rounded-md px-2 text-[12px] font-normal leading-4 text-foreground/80 focus:bg-sidebar-accent focus:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0'
const CONTEXT_MENU_SUB_TRIGGER_CLASS =
  'h-7 gap-2 rounded-md px-2 text-[12px] font-normal leading-4 text-foreground/80 focus:bg-sidebar-accent focus:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0'

type ScrollbarStage = 'active' | 'fade-1' | 'fade-2' | 'fade-3' | 'idle'

const SCROLLBAR_THUMB_CLASS_BY_STAGE: Record<ScrollbarStage, string> = {
  active:
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,var(--color-scrollbar-thumb)_0%,var(--color-scrollbar-thumb)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_55%,transparent)_72%,transparent_100%)]',
  'fade-1':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_70%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_70%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_35%,transparent)_72%,transparent_100%)]',
  'fade-2':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_40%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_40%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_20%,transparent)_72%,transparent_100%)]',
  'fade-3':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_16%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_16%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_8%,transparent)_72%,transparent_100%)]',
  idle: '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,transparent_0%,transparent_50%,transparent_100%)]'
}

const SCROLLBAR_COLOR_BY_STAGE: Record<ScrollbarStage, string> = {
  active: 'var(--color-scrollbar-thumb) transparent',
  'fade-1': 'color-mix(in srgb, var(--color-scrollbar-thumb) 70%, transparent) transparent',
  'fade-2': 'color-mix(in srgb, var(--color-scrollbar-thumb) 40%, transparent) transparent',
  'fade-3': 'color-mix(in srgb, var(--color-scrollbar-thumb) 16%, transparent) transparent',
  idle: 'transparent transparent'
}

export type {
  ResourceListActionMap,
  ResourceListContextValue,
  ResourceListFilterOption,
  ResourceListGroup,
  ResourceListItemBase,
  ResourceListMeta,
  ResourceListReorderPayload,
  ResourceListSortOption,
  ResourceListState,
  ResourceListStatus,
  ResourceListVariantContext,
  ResourceListView,
  ResourceListViewGroup
} from './ResourceListContext'

type ResourceListProviderProps<T extends ResourceListItemBase> = {
  items: readonly T[]
  children: ReactNode
  variant?: ResourceListVariantContext['variant']
  status?: ResourceListStatus
  selectedId?: string | null
  defaultSortId?: string
  sortOptions?: ResourceListSortOption<T>[]
  filterOptions?: ResourceListFilterOption<T>[]
  groupBy?: (item: T) => ResourceListGroup | null
  getItemId?: (item: T) => string
  getItemLabel?: (item: T) => string
  defaultGroupVisibleCount?: number
  groupLoadStep?: number
  groupShowMoreLabel?: string
  groupCollapseLabel?: string
  estimateItemSize?: (index: number) => number
  onSelectItem?: (id: string) => void
  onRenameItem?: (id: string, name: string) => void
  onOpenContextMenu?: (id: string) => void
  onReorder?: (payload: ResourceListReorderPayload) => void
}

type ProviderAction =
  | { type: 'setQuery'; query: string }
  | { type: 'setFilters'; filters: string[] }
  | { type: 'setSort'; sort: string | null }
  | { type: 'selectItem'; id: string | null }
  | { type: 'hoverItem'; id: string | null }
  | { type: 'startRename'; id: string }
  | { type: 'cancelRename' }
  | { type: 'showMoreInGroup'; groupId: string; defaultCount: number; step: number }
  | { type: 'collapseGroupItems'; groupId: string; defaultCount: number }
  | { type: 'toggleGroup'; groupId: string }
  | { type: 'startDrag'; id: string }
  | { type: 'endDrag' }
  | { type: 'setStatus'; status: ResourceListStatus }

function reducer(state: ResourceListState, action: ProviderAction): ResourceListState {
  switch (action.type) {
    case 'setQuery':
      return { ...state, query: action.query }
    case 'setFilters':
      return { ...state, filters: action.filters }
    case 'setSort':
      return { ...state, sort: action.sort }
    case 'selectItem':
      return { ...state, selectedId: action.id }
    case 'hoverItem':
      return { ...state, hoveredId: action.id }
    case 'startRename':
      return { ...state, renamingId: action.id }
    case 'cancelRename':
      return { ...state, renamingId: null }
    case 'showMoreInGroup': {
      const current = state.groupVisibleCounts[action.groupId] ?? action.defaultCount
      return {
        ...state,
        groupVisibleCounts: {
          ...state.groupVisibleCounts,
          [action.groupId]: current + action.step
        }
      }
    }
    case 'collapseGroupItems':
      return {
        ...state,
        groupVisibleCounts: {
          ...state.groupVisibleCounts,
          [action.groupId]: action.defaultCount
        }
      }
    case 'toggleGroup': {
      const collapsedGroups = state.collapsedGroups.includes(action.groupId)
        ? state.collapsedGroups.filter((groupId) => groupId !== action.groupId)
        : [...state.collapsedGroups, action.groupId]
      return { ...state, collapsedGroups }
    }
    case 'startDrag':
      return { ...state, draggingId: action.id }
    case 'endDrag':
      return { ...state, draggingId: null }
    case 'setStatus':
      return { ...state, status: action.status }
  }
}

function ResourceListProvider<T extends ResourceListItemBase>({
  items,
  children,
  variant = 'resource',
  status = 'idle',
  selectedId: selectedIdProp,
  defaultSortId,
  sortOptions = [],
  filterOptions = [],
  groupBy,
  getItemId = (item) => item.id,
  getItemLabel = (item) => item.name,
  defaultGroupVisibleCount = 5,
  groupLoadStep = 5,
  groupShowMoreLabel = DEFAULT_GROUP_SHOW_MORE_LABEL,
  groupCollapseLabel = DEFAULT_GROUP_COLLAPSE_LABEL,
  estimateItemSize = () => 34,
  onSelectItem,
  onRenameItem,
  onOpenContextMenu,
  onReorder
}: ResourceListProviderProps<T>) {
  const [state, dispatch] = useReducer(reducer, {
    query: '',
    filters: [],
    sort: defaultSortId ?? null,
    selectedId: selectedIdProp ?? null,
    hoveredId: null,
    renamingId: null,
    collapsedGroups: [],
    groupVisibleCounts: {},
    draggingId: null,
    status
  })

  const activeFilters = useMemo(() => new Set(state.filters), [state.filters])
  const filterById = useMemo(() => new Map(filterOptions.map((option) => [option.id, option])), [filterOptions])
  const sortById = useMemo(() => new Map(sortOptions.map((option) => [option.id, option])), [sortOptions])

  const viewItems = useMemo(() => {
    const normalizedQuery = state.query.trim().toLowerCase()
    let next = [...items]

    if (normalizedQuery) {
      next = next.filter((item) => getItemLabel(item).toLowerCase().includes(normalizedQuery))
    }

    if (activeFilters.size > 0) {
      next = next.filter((item) => {
        for (const filterId of activeFilters) {
          const filter = filterById.get(filterId)
          if (filter && !filter.predicate(item)) return false
        }
        return true
      })
    }

    const sort = state.sort ? sortById.get(state.sort) : null
    if (sort) {
      next.sort(sort.comparator)
    }

    return next
  }, [activeFilters, filterById, getItemLabel, items, sortById, state.query, state.sort])

  const viewGroups = useMemo(() => {
    const collapsedGroups = new Set(state.collapsedGroups)

    if (!groupBy) {
      const group = { id: 'all', label: '' }
      return [
        {
          group,
          allItems: viewItems,
          items: viewItems,
          totalCount: viewItems.length,
          visibleCount: viewItems.length,
          hasMore: false,
          canCollapseToDefault: false,
          collapsed: false
        }
      ]
    }

    const groups = new Map<string, { group: ResourceListGroup; items: T[] }>()
    for (const item of viewItems) {
      const group = groupBy(item) ?? { id: 'ungrouped', label: '' }
      const existing = groups.get(group.id)
      if (existing) {
        existing.items.push(item)
      } else {
        groups.set(group.id, { group, items: [item] })
      }
    }
    return [...groups.values()].map(({ group, items }) => {
      const totalCount = items.length
      const collapsed = collapsedGroups.has(group.id)
      const configuredVisibleCount = state.groupVisibleCounts[group.id] ?? defaultGroupVisibleCount
      const visibleCount = Math.min(configuredVisibleCount, totalCount)
      const hasMore = !collapsed && visibleCount < totalCount
      const canCollapseToDefault = !collapsed && totalCount > defaultGroupVisibleCount && visibleCount >= totalCount

      return {
        group: { ...group, count: group.count ?? totalCount },
        allItems: items,
        items: collapsed ? [] : items.slice(0, visibleCount),
        totalCount,
        visibleCount: collapsed ? 0 : visibleCount,
        hasMore,
        canCollapseToDefault,
        collapsed
      }
    })
  }, [defaultGroupVisibleCount, groupBy, state.collapsedGroups, state.groupVisibleCounts, viewItems])

  const visibleItems = useMemo(() => viewGroups.flatMap((group) => group.items), [viewGroups])

  const actions = useMemo(
    () => ({
      setQuery: (query: string) => dispatch({ type: 'setQuery', query }),
      setFilters: (filters: string[]) => dispatch({ type: 'setFilters', filters }),
      toggleFilter: (filterId: string) => {
        const next = new Set(state.filters)
        if (next.has(filterId)) {
          next.delete(filterId)
        } else {
          next.add(filterId)
        }
        dispatch({ type: 'setFilters', filters: [...next] })
      },
      setSort: (sortId: string | null) => dispatch({ type: 'setSort', sort: sortId }),
      selectItem: (id: string) => {
        dispatch({ type: 'selectItem', id })
        onSelectItem?.(id)
      },
      hoverItem: (id: string | null) => dispatch({ type: 'hoverItem', id }),
      startRename: (id: string) => dispatch({ type: 'startRename', id }),
      commitRename: (id: string, name: string) => {
        onRenameItem?.(id, name)
        dispatch({ type: 'cancelRename' })
      },
      cancelRename: () => dispatch({ type: 'cancelRename' }),
      openContextMenu: (id: string) => onOpenContextMenu?.(id),
      showMoreInGroup: (groupId: string) =>
        dispatch({ type: 'showMoreInGroup', groupId, defaultCount: defaultGroupVisibleCount, step: groupLoadStep }),
      collapseGroupItems: (groupId: string) =>
        dispatch({ type: 'collapseGroupItems', groupId, defaultCount: defaultGroupVisibleCount }),
      toggleGroup: (groupId: string) => dispatch({ type: 'toggleGroup', groupId }),
      reorder: (payload: ResourceListReorderPayload) => onReorder?.(payload)
    }),
    [defaultGroupVisibleCount, groupLoadStep, onOpenContextMenu, onRenameItem, onReorder, onSelectItem, state.filters]
  )

  const context = useMemo<ResourceListContextValue<T>>(
    () => ({
      state: { ...state, selectedId: selectedIdProp !== undefined ? selectedIdProp : state.selectedId, status },
      actions,
      meta: {
        variant,
        getItemId,
        getItemLabel,
        groups: viewGroups.map((group) => group.group),
        sortOptions,
        filterOptions,
        estimateItemSize,
        defaultGroupVisibleCount,
        groupLoadStep,
        groupShowMoreLabel,
        groupCollapseLabel
      },
      sourceItems: items,
      view: {
        items: viewItems,
        visibleItems,
        groups: viewGroups
      }
    }),
    [
      actions,
      defaultGroupVisibleCount,
      estimateItemSize,
      filterOptions,
      getItemId,
      getItemLabel,
      groupLoadStep,
      groupCollapseLabel,
      groupShowMoreLabel,
      items,
      selectedIdProp,
      sortOptions,
      state,
      status,
      variant,
      visibleItems,
      viewGroups,
      viewItems
    ]
  )

  return (
    <ResourceListContext value={context as unknown as ResourceListContextValue<ResourceListItemBase>}>
      {children}
    </ResourceListContext>
  )
}

type FrameProps = ComponentProps<'div'> & {
  ref?: Ref<HTMLDivElement>
}

function Frame({ className, ref, ...props }: FrameProps) {
  const { meta } = useResourceList()
  return (
    <div
      ref={ref}
      data-resource-list-variant={meta.variant}
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar text-sidebar-foreground', className)}
      {...props}
    />
  )
}

type SearchProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  icon?: ReactNode
  wrapperClassName?: string
  ref?: Ref<HTMLInputElement>
}

function Search({ className, icon, wrapperClassName, ref, ...props }: SearchProps) {
  const { actions, state } = useResourceList()
  const searchIcon = icon === undefined ? <SearchIcon size={12} /> : icon
  return (
    <div className={cn('relative', wrapperClassName)}>
      {searchIcon && (
        <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 flex text-muted-foreground/45">
          {searchIcon}
        </span>
      )}
      <Input
        ref={ref}
        value={state.query}
        onChange={(event) => actions.setQuery(event.target.value)}
        className={cn(
          'h-7 rounded-full border border-sidebar-border/40 bg-background/35 pr-2 text-[10px] text-sidebar-foreground/65 shadow-none transition-colors',
          'placeholder:text-[10px] placeholder:text-muted-foreground/45 focus-visible:border-sidebar-border/70 focus-visible:ring-0',
          searchIcon ? 'pl-6' : 'pl-2',
          className
        )}
        {...props}
      />
    </div>
  )
}

type HeaderProps = ComponentProps<'div'> & {
  actions?: ReactNode
  count?: ReactNode
  icon?: ReactNode
  ref?: Ref<HTMLDivElement>
  title?: ReactNode
}

function Header({ actions, children, className, count, icon, ref, title, ...props }: HeaderProps) {
  return (
    <div ref={ref} className={cn('flex shrink-0 flex-col gap-2.5 px-3 pt-2.5 pb-1.5', className)} {...props}>
      {(title || actions) && (
        <div className="flex h-5 items-center gap-1.5">
          {icon && (
            <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/50">{icon}</span>
          )}
          <div className="min-w-0 flex flex-1 items-baseline gap-1">
            {title && (
              <span className="truncate font-medium text-[12px] text-muted-foreground/60 leading-4">{title}</span>
            )}
            {count !== undefined && (
              <span className="shrink-0 font-medium text-[12px] text-muted-foreground/40 leading-4 tabular-nums">
                {count}
              </span>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground/55">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

type HeaderActionButtonProps = ComponentProps<typeof Button> & {
  ref?: Ref<HTMLButtonElement>
}

function HeaderActionButton({ className, ref, size, variant = 'ghost', ...props }: HeaderActionButtonProps) {
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center p-0 leading-none text-muted-foreground/55 shadow-none hover:bg-transparent hover:text-muted-foreground/75 [&_svg]:block [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

type ListViewportProps = ComponentProps<'div'> & {
  ref?: Ref<HTMLDivElement>
}

function useAutoHideScrollbar(delay = SCROLLBAR_AUTO_HIDE_DELAY) {
  const [stage, setStage] = useState<ScrollbarStage>('idle')
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearScrollingTimeout = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout)
    timeoutRefs.current = []
  }, [])

  const handleScroll = useCallback(() => {
    clearScrollingTimeout()
    setStage('active')
    timeoutRefs.current = [
      setTimeout(() => setStage('fade-1'), delay),
      setTimeout(() => setStage('fade-2'), delay + SCROLLBAR_FADE_STEP),
      setTimeout(() => setStage('fade-3'), delay + SCROLLBAR_FADE_STEP * 2),
      setTimeout(() => setStage('idle'), delay + SCROLLBAR_FADE_STEP * 3)
    ]
  }, [clearScrollingTimeout, delay])

  useEffect(() => clearScrollingTimeout, [clearScrollingTimeout])

  return { stage, handleScroll }
}

function ListViewport({ className, onScroll, ref, role, style, ...props }: ListViewportProps) {
  const { stage, handleScroll } = useAutoHideScrollbar()
  const isScrolling = stage !== 'idle'

  return (
    <div
      ref={ref}
      data-scrolling={isScrolling ? 'true' : 'false'}
      role={role}
      className={cn(
        'min-h-0 flex-1 overflow-auto px-1.5 py-1.5 [scrollbar-gutter:stable]',
        '[&::-webkit-scrollbar-thumb:hover]:bg-[var(--color-scrollbar-thumb-hover)]',
        '[&::-webkit-scrollbar-thumb]:transition-[background] [&::-webkit-scrollbar-thumb]:duration-150 [&::-webkit-scrollbar-thumb]:ease-out',
        SCROLLBAR_THUMB_CLASS_BY_STAGE[stage],
        className
      )}
      onScroll={(event) => {
        handleScroll()
        onScroll?.(event)
      }}
      style={{
        ...style,
        scrollbarColor: SCROLLBAR_COLOR_BY_STAGE[stage]
      }}
      {...props}
    />
  )
}

type FilterBarProps = ComponentProps<'div'> & {
  ref?: Ref<HTMLDivElement>
}

function FilterBar({ className, ref, ...props }: FilterBarProps) {
  const { actions, meta, state } = useResourceList()

  if (meta.filterOptions.length === 0 && meta.sortOptions.length === 0) {
    return null
  }

  return (
    <div ref={ref} className={cn('flex flex-wrap items-center gap-1.5 p-2', className)} {...props}>
      {meta.filterOptions.map((option) => {
        const active = state.filters.includes(option.id)
        return (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'ghost'}
            data-active={active || undefined}
            onClick={() => actions.toggleFilter(option.id)}>
            {option.label}
          </Button>
        )
      })}
      {meta.sortOptions.map((option) => {
        const active = state.sort === option.id
        return (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'ghost'}
            data-active={active || undefined}
            onClick={() => actions.setSort(active ? null : option.id)}>
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

type GroupHeaderProps = ComponentProps<'div'> & {
  group: ResourceListGroup
  ref?: Ref<HTMLDivElement>
}

function GroupHeader({ group, className, ref, ...props }: GroupHeaderProps) {
  const { actions, view } = useResourceList()
  const viewGroup = view.groups.find((candidate) => candidate.group.id === group.id)
  const collapsed = viewGroup?.collapsed ?? false

  if (!group.label) return null
  return (
    <div
      ref={ref}
      className={cn(
        'flex h-7 items-center gap-1.5 px-1.5 pt-2 pb-1 font-medium text-muted-foreground/70 text-[11px]',
        className
      )}
      {...props}>
      <button
        type="button"
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => actions.toggleGroup(group.id)}>
        <span className="flex size-5 shrink-0 items-center justify-center">
          <CalendarDays size={13} />
        </span>
        <span className="truncate">{group.label}</span>
      </button>
      {typeof group.count === 'number' && <span className="ml-auto shrink-0 tabular-nums">{group.count}</span>}
    </div>
  )
}

type GroupShowMoreProps = ComponentProps<'div'> & {
  groupId: string
  ref?: Ref<HTMLDivElement>
}

function GroupShowMore({ groupId, className, ref, ...props }: GroupShowMoreProps) {
  const { actions, meta, view } = useResourceList()
  const viewGroup = view.groups.find((candidate) => candidate.group.id === groupId)
  const canCollapseToDefault = viewGroup?.canCollapseToDefault === true
  const label = canCollapseToDefault ? meta.groupCollapseLabel : meta.groupShowMoreLabel

  return (
    <div ref={ref} className={cn('flex justify-center px-2 py-1', className)} {...props}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'flex h-6 min-w-10 items-center justify-center rounded-md px-2 text-muted-foreground transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        )}
        onClick={() => {
          if (canCollapseToDefault) {
            actions.collapseGroupItems(groupId)
            return
          }
          actions.showMoreInGroup(groupId)
        }}>
        {canCollapseToDefault ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
      </button>
    </div>
  )
}

type ItemProps<T extends ResourceListItemBase> = ComponentProps<'div'> & {
  item: T
  ref?: Ref<HTMLDivElement>
}

function Item<T extends ResourceListItemBase>({
  item,
  className,
  ref,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...props
}: ItemProps<T>) {
  const { actions, meta, state } = useResourceList<T>()
  const id = meta.getItemId(item)
  const selected = state.selectedId === id
  const hovered = state.hoveredId === id

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      data-selected={selected || undefined}
      data-hovered={hovered || undefined}
      className={cn(
        'group flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm outline-none transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
        className
      )}
      onClick={(event) => {
        actions.selectItem(id)
        onClick?.(event)
      }}
      onMouseEnter={(event) => {
        actions.hoverItem(id)
        onMouseEnter?.(event)
      }}
      onMouseLeave={(event) => {
        actions.hoverItem(null)
        onMouseLeave?.(event)
      }}
      {...props}
    />
  )
}

type RenameFieldProps<T extends ResourceListItemBase> = Omit<
  ComponentProps<typeof Input>,
  'defaultValue' | 'onKeyDown' | 'onBlur'
> & {
  item: T
  ref?: Ref<HTMLInputElement>
}

function RenameField<T extends ResourceListItemBase>({ item, className, ref, ...props }: RenameFieldProps<T>) {
  const { actions, meta, state } = useResourceList<T>()
  const id = meta.getItemId(item)
  if (state.renamingId !== id) return null

  return (
    <Input
      ref={ref}
      autoFocus
      defaultValue={meta.getItemLabel(item)}
      className={cn(
        'h-6 flex-1 border-none bg-transparent px-0 text-[12px] text-sidebar-foreground/70 shadow-none focus-visible:ring-0',
        className
      )}
      onBlur={(event) => actions.commitRename(id, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          actions.commitRename(id, event.currentTarget.value)
        }
        if (event.key === 'Escape') {
          actions.cancelRename()
        }
      }}
      {...props}
    />
  )
}

type ItemTitleProps = ComponentProps<'span'> & {
  ref?: Ref<HTMLSpanElement>
}

function ItemTitle({ className, ref, ...props }: ItemTitleProps) {
  return (
    <span
      ref={ref}
      className={cn(
        'min-w-0 flex-1 truncate text-left font-medium text-[12px] text-sidebar-foreground/70 leading-5',
        className
      )}
      {...props}
    />
  )
}

type ItemIconProps = ComponentProps<'span'> & {
  ref?: Ref<HTMLSpanElement>
}

function ItemIcon({ className, ref, ...props }: ItemIconProps) {
  return (
    <span
      ref={ref}
      className={cn('flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70', className)}
      {...props}
    />
  )
}

type ItemActionProps = ComponentProps<'button'> & {
  ref?: Ref<HTMLButtonElement>
}

function ItemAction({ className, ref, type = 'button', ...props }: ItemActionProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-colors transition-opacity',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'group-hover:opacity-100 group-data-[selected=true]:opacity-100 data-[deleting=true]:opacity-100',
        className
      )}
      {...props}
    />
  )
}

type ItemLeadingActionProps = ItemActionProps

function ItemLeadingAction({ className, ref, type = 'button', ...props }: ItemLeadingActionProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-colors transition-opacity',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'group-hover:opacity-100 group-data-[selected=true]:opacity-100 data-[active=true]:opacity-100',
        className
      )}
      {...props}
    />
  )
}

type VirtualItemsProps<T extends ResourceListItemBase> = {
  className?: string
  ref?: Ref<HTMLDivElement>
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
}

type ResourceListVirtualRow<T extends ResourceListItemBase> =
  | { type: 'group'; group: ResourceListGroup }
  | { type: 'group-more'; groupId: string }
  | { type: 'item'; item: T; itemIndex: number }

function buildVirtualRows<T extends ResourceListItemBase>(context: ResourceListContextValue<T>) {
  const rows: ResourceListVirtualRow<T>[] = []
  let itemIndex = 0

  for (const group of context.view.groups) {
    if (group.group.label) {
      rows.push({ type: 'group', group: group.group })
    }

    for (const item of group.items) {
      rows.push({ type: 'item', item, itemIndex })
      itemIndex += 1
    }

    if (group.hasMore || group.canCollapseToDefault) {
      rows.push({ type: 'group-more', groupId: group.group.id })
    }
  }

  return rows
}

function VirtualItems<T extends ResourceListItemBase>({ className, ref, renderItem }: VirtualItemsProps<T>) {
  const context = useResourceList<T>()
  const parentRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => buildVirtualRows(context), [context])
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      parentRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index]
      if (row?.type === 'group') return 24
      if (row?.type === 'group-more') return 32
      return context.meta.estimateItemSize(row?.itemIndex ?? index)
    },
    overscan: 6
  })
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <ListViewport ref={setScrollRef} className={className} role="listbox">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index]
          if (!row) return null
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{
                minHeight: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`
              }}>
              {row.type === 'group' ? (
                <GroupHeader group={row.group} />
              ) : row.type === 'group-more' ? (
                <GroupShowMore groupId={row.groupId} />
              ) : (
                renderItem(row.item, context)
              )}
            </div>
          )
        })}
      </div>
    </ListViewport>
  )
}

type ContextMenuProps<T extends ResourceListItemBase> = {
  item: T
  children: ReactNode
  content: ReactNode
  contentClassName?: string
}

function ContextMenu<T extends ResourceListItemBase>({
  item,
  children,
  content,
  contentClassName
}: ContextMenuProps<T>) {
  const { actions, meta } = useResourceList<T>()
  return (
    <UiContextMenu onOpenChange={(open) => open && actions.openContextMenu(meta.getItemId(item))}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={cn(CONTEXT_MENU_CONTENT_CLASS, contentClassName)}>{content}</ContextMenuContent>
    </UiContextMenu>
  )
}

type ContextMenuActionProps = ComponentProps<typeof ContextMenuItem> & {
  icon?: ReactNode
}

function ContextMenuAction({ children, className, icon, variant, ...props }: ContextMenuActionProps) {
  return (
    <ContextMenuItem
      variant={variant}
      className={cn(
        CONTEXT_MENU_ITEM_CLASS,
        variant === 'destructive' && 'text-destructive focus:bg-destructive/10 focus:text-destructive',
        className
      )}
      {...props}>
      {icon && (
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center',
            variant === 'destructive' ? 'text-destructive' : 'text-muted-foreground'
          )}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
    </ContextMenuItem>
  )
}

type ContextMenuSubActionProps = ComponentProps<typeof UiContextMenuSubTrigger> & {
  icon?: ReactNode
}

function ContextMenuSubAction({ children, className, icon, ...props }: ContextMenuSubActionProps) {
  return (
    <UiContextMenuSubTrigger className={cn(CONTEXT_MENU_SUB_TRIGGER_CLASS, className)} {...props}>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
    </UiContextMenuSubTrigger>
  )
}

function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof UiContextMenuSeparator>) {
  return <UiContextMenuSeparator className={cn('my-1 bg-border/70', className)} {...props} />
}

function ContextMenuSubContent({ className, ...props }: ComponentProps<typeof UiContextMenuSubContent>) {
  return <UiContextMenuSubContent className={cn(CONTEXT_MENU_CONTENT_CLASS, className)} {...props} />
}

type ContextMenuRenameActionProps<T extends ResourceListItemBase> = {
  item: T
  label: string
}

function ContextMenuRenameAction<T extends ResourceListItemBase>({ item, label }: ContextMenuRenameActionProps<T>) {
  const { actions, meta } = useResourceList<T>()
  return <ContextMenuItem onSelect={() => actions.startRename(meta.getItemId(item))}>{label}</ContextMenuItem>
}

type DraggableItemsProps<T extends ResourceListItemBase> = {
  className?: string
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
}

type VirtualDraggableItemsProps<T extends ResourceListItemBase> = DraggableItemsProps<T> & {
  ref?: Ref<HTMLDivElement>
}

function useResourceListDnd<T extends ResourceListItemBase>(context: ResourceListContextValue<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )
  const itemIds = context.view.visibleItems.map((item) => context.meta.getItemId(item))

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      context.actions.hoverItem(String(event.active.id))
    },
    [context.actions]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      context.actions.hoverItem(null)
      const activeId = String(event.active.id)
      const overId = event.over?.id ? String(event.over.id) : null
      if (!overId || activeId === overId) return
      context.actions.reorder({ activeId, overId, position: 'after' })
    },
    [context.actions]
  )

  return { sensors, itemIds, handleDragStart, handleDragEnd }
}

function DraggableItems<T extends ResourceListItemBase>({ className, renderItem }: DraggableItemsProps<T>) {
  const context = useResourceList<T>()
  const { sensors, itemIds, handleDragStart, handleDragEnd } = useResourceListDnd(context)

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ListViewport className={cn('flex flex-col gap-1', className)}>
          {context.view.groups.map((group) => (
            <div key={group.group.id} className="contents">
              <GroupHeader group={group.group} />
              {group.items.map((item) => (
                <SortableResourceItem key={context.meta.getItemId(item)} item={item}>
                  {renderItem(item, context)}
                </SortableResourceItem>
              ))}
              {(group.hasMore || group.canCollapseToDefault) && <GroupShowMore groupId={group.group.id} />}
            </div>
          ))}
        </ListViewport>
      </SortableContext>
    </DndContext>
  )
}

function VirtualDraggableItems<T extends ResourceListItemBase>({
  className,
  ref,
  renderItem
}: VirtualDraggableItemsProps<T>) {
  const context = useResourceList<T>()
  const parentRef = useRef<HTMLDivElement>(null)
  const { sensors, itemIds, handleDragStart, handleDragEnd } = useResourceListDnd(context)
  const rows = useMemo(() => buildVirtualRows(context), [context])
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      parentRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index]
      if (row?.type === 'group') return 24
      if (row?.type === 'group-more') return 32
      return context.meta.estimateItemSize(row?.itemIndex ?? index)
    },
    overscan: 6
  })
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ListViewport ref={setScrollRef} className={className} role="listbox">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index]
              if (!row) return null
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    minHeight: virtualItem.size,
                    transform: `translateY(${virtualItem.start}px)`
                  }}>
                  {row.type === 'group' ? (
                    <GroupHeader group={row.group} />
                  ) : row.type === 'group-more' ? (
                    <GroupShowMore groupId={row.groupId} />
                  ) : (
                    <SortableResourceItem item={row.item}>{renderItem(row.item, context)}</SortableResourceItem>
                  )}
                </div>
              )
            })}
          </div>
        </ListViewport>
      </SortableContext>
    </DndContext>
  )
}

function SortableResourceItem<T extends ResourceListItemBase>({ item, children }: { item: T; children: ReactNode }) {
  const { meta } = useResourceList<T>()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: meta.getItemId(item)
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  )
}

type EmptyStateProps = ComponentProps<typeof UiEmptyState>

function EmptyState(props: EmptyStateProps) {
  return <UiEmptyState compact preset="no-resource" {...props} />
}

type LoadingStateProps = ComponentProps<'div'> & {
  ref?: Ref<HTMLDivElement>
}

function LoadingState({ className, ref, ...props }: LoadingStateProps) {
  return (
    <div ref={ref} className={cn('flex flex-col gap-2 p-3', className)} {...props}>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4" />
    </div>
  )
}

type ErrorStateProps = ComponentProps<'div'> & {
  message?: ReactNode
  ref?: Ref<HTMLDivElement>
}

function ErrorState({ className, message, ref, children, ...props }: ErrorStateProps) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn('m-2 rounded-md border border-destructive/40 p-3 text-sm', className)}
      {...props}>
      {message ?? children}
    </div>
  )
}

const ResourceList = {
  Provider: ResourceListProvider,
  Frame,
  Header,
  HeaderActionButton,
  Search,
  FilterBar,
  GroupHeader,
  GroupShowMore,
  VirtualItems,
  DraggableItems,
  VirtualDraggableItems,
  Item,
  ItemAction,
  ItemIcon,
  ItemLeadingAction,
  ItemTitle,
  RenameField,
  ContextMenu,
  ContextMenuAction,
  ContextMenuRenameAction,
  ContextMenuSeparator,
  ContextMenuSubAction,
  ContextMenuSubContent,
  EmptyState,
  LoadingState,
  ErrorState
}

export { ResourceList, useResourceList }
