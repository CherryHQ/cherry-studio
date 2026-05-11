import {
  Button,
  ContextMenu as UiContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import type { ComponentProps, CSSProperties, ReactNode, Ref } from 'react'
import { useCallback, useMemo, useReducer, useRef } from 'react'

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
  estimateItemSize = () => 40,
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
    expandedGroups: [],
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
    if (!groupBy) {
      return [{ group: { id: 'all', label: '' }, items: viewItems }]
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
    return [...groups.values()]
  }, [groupBy, viewItems])

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
      reorder: (payload: ResourceListReorderPayload) => onReorder?.(payload)
    }),
    [onOpenContextMenu, onRenameItem, onReorder, onSelectItem, state.filters]
  )

  const context = useMemo<ResourceListContextValue<T>>(
    () => ({
      state: { ...state, selectedId: selectedIdProp ?? state.selectedId, status },
      actions,
      meta: {
        variant,
        getItemId,
        getItemLabel,
        groups: viewGroups.map((group) => group.group),
        sortOptions,
        filterOptions,
        estimateItemSize
      },
      sourceItems: items,
      view: {
        items: viewItems,
        groups: viewGroups
      }
    }),
    [
      actions,
      estimateItemSize,
      filterOptions,
      getItemId,
      getItemLabel,
      items,
      selectedIdProp,
      sortOptions,
      state,
      status,
      variant,
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
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar text-foreground', className)}
      {...props}
    />
  )
}

type SearchProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  ref?: Ref<HTMLInputElement>
}

function Search({ className, ref, ...props }: SearchProps) {
  const { actions, state } = useResourceList()
  return (
    <Input
      ref={ref}
      value={state.query}
      onChange={(event) => actions.setQuery(event.target.value)}
      className={cn('h-8 border-border bg-background text-sm', className)}
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
  if (!group.label) return null
  return (
    <div
      ref={ref}
      className={cn('px-3 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase', className)}
      {...props}>
      {group.label}
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
        'group flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        selected && 'bg-sidebar-primary text-sidebar-primary-foreground shadow-xs',
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
      className={cn('h-7 flex-1 bg-background text-sm', className)}
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

type VirtualItemsProps<T extends ResourceListItemBase> = {
  className?: string
  ref?: Ref<HTMLDivElement>
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
}

function VirtualItems<T extends ResourceListItemBase>({ className, ref, renderItem }: VirtualItemsProps<T>) {
  const context = useResourceList<T>()
  const parentRef = useRef<HTMLDivElement>(null)
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
    count: context.view.items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: context.meta.estimateItemSize,
    overscan: 6
  })
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={setScrollRef} className={cn('min-h-0 flex-1 overflow-auto px-2 py-1', className)} role="listbox">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualItem) => {
          const item = context.view.items[virtualItem.index]
          if (!item) return null
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
              {renderItem(item, context)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ContextMenuProps<T extends ResourceListItemBase> = {
  item: T
  children: ReactNode
  content: ReactNode
}

function ContextMenu<T extends ResourceListItemBase>({ item, children, content }: ContextMenuProps<T>) {
  const { actions, meta } = useResourceList<T>()
  return (
    <UiContextMenu onOpenChange={(open) => open && actions.openContextMenu(meta.getItemId(item))}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>{content}</ContextMenuContent>
    </UiContextMenu>
  )
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

function DraggableItems<T extends ResourceListItemBase>({ className, renderItem }: DraggableItemsProps<T>) {
  const context = useResourceList<T>()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )
  const itemIds = context.view.items.map((item) => context.meta.getItemId(item))

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      context.actions.hoverItem(String(event.active.id))
    },
    [context.actions]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id)
      const overId = event.over?.id ? String(event.over.id) : null
      if (!overId || activeId === overId) return
      context.actions.reorder({ activeId, overId, position: 'after' })
    },
    [context.actions]
  )

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-2 py-1', className)}>
          {context.view.groups.map((group) => (
            <div key={group.group.id} className="contents">
              <GroupHeader group={group.group} />
              {group.items.map((item) => (
                <SortableResourceItem key={context.meta.getItemId(item)} item={item}>
                  {renderItem(item, context)}
                </SortableResourceItem>
              ))}
            </div>
          ))}
        </div>
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
  Search,
  FilterBar,
  GroupHeader,
  VirtualItems,
  DraggableItems,
  Item,
  RenameField,
  ContextMenu,
  ContextMenuRenameAction,
  EmptyState,
  LoadingState,
  ErrorState
}

export { ResourceList, useResourceList }
