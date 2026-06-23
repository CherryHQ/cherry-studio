import { Button, EmptyState as UiEmptyState, Input, MenuItem, Skeleton, Tooltip } from '@cherrystudio/ui'
import { CommandHint } from '@renderer/components/command'
import { cn } from '@renderer/utils/style'
import type { CommandId } from '@shared/utils/command/definitions'
import { SearchIcon, SquareMinus } from 'lucide-react'
import type { ComponentProps, ReactNode, Ref } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getResourceListOptionDomId,
  type ResourceListContextValue,
  type ResourceListItemBase,
  useResourceList,
  useResourceListActions,
  useResourceListControlsState,
  useResourceListGroupState,
  useResourceListItemAccessors,
  useResourceListMeta,
  useResourceListRowState,
  useResourceListView
} from './ResourceListContext'
import { GroupHeader, GroupShowMore } from './ResourceListGroups'
import {
  RESOURCE_LIST_INTERACTIVE_ROW_CLASS,
  RESOURCE_LIST_ROW_HEIGHT_CLASS,
  RESOURCE_LIST_SELECTED_ROW_CLASS,
  RESOURCE_LIST_VISUAL_ROW_CLASS
} from './resourceListLayout'
import { ResourceListLeadingSlot, type ResourceListLeadingSlotProps } from './ResourceListLeadingSlot'
import { ResourceListProvider } from './ResourceListProvider'
import { VirtualDraggableItems, VirtualItems } from './ResourceListVirtual'

export type {
  ResourceListActionMap,
  ResourceListContextValue,
  ResourceListDragCapabilities,
  ResourceListExpansionState,
  ResourceListFilterOption,
  ResourceListGroup,
  ResourceListGroupHeaderClickBehavior,
  ResourceListGroupSeed,
  ResourceListItemAccessors,
  ResourceListItemBase,
  ResourceListMeta,
  ResourceListReorderPayload,
  ResourceListRevealRequest,
  ResourceListSection,
  ResourceListSortOption,
  ResourceListState,
  ResourceListStatus,
  ResourceListVariantContext,
  ResourceListView,
  ResourceListViewGroup,
  ResourceListViewSection
} from './ResourceListContext'
export type { ResourceListGroupReorderPayload, ResourceListItemReorderPayload } from './ResourceListContext'

type FrameProps = ComponentProps<'div'> & {
  ref?: Ref<HTMLDivElement>
}

function Frame({ className, ref, ...props }: FrameProps) {
  const meta = useResourceListMeta()
  return (
    <div
      ref={ref}
      data-resource-list-variant={meta.variant}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden border-border border-r-[0.5px] p-1.5 text-sidebar-foreground',
        className
      )}
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
  const actions = useResourceListActions()
  const state = useResourceListControlsState()
  const searchIcon = icon === undefined ? <SearchIcon size={12} /> : icon
  return (
    <div className={cn('relative', wrapperClassName)}>
      {searchIcon && (
        <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 flex text-foreground-muted">
          {searchIcon}
        </span>
      )}
      <Input
        ref={ref}
        value={state.query}
        onChange={(event) => actions.setQuery(event.target.value)}
        className={cn(
          'h-7 rounded-full border border-sidebar-border bg-sidebar pr-2 text-[10px] text-sidebar-foreground shadow-none transition-colors md:text-[10px]',
          'placeholder:text-[10px] placeholder:text-foreground-muted focus-visible:border-sidebar-ring focus-visible:ring-0',
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
    <div ref={ref} className={cn('flex shrink-0 flex-col gap-2.5 pb-1', className)} {...props}>
      {(title || actions) && (
        <div className="flex h-5 items-center gap-1.5">
          {icon && (
            <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/50">{icon}</span>
          )}
          <div className="flex min-w-0 flex-1 items-baseline gap-1">
            {title && (
              <span className="truncate font-medium text-[12px] text-muted-foreground/60 leading-4">{title}</span>
            )}
            {count !== undefined && (
              <span className="shrink-0 font-medium text-[12px] text-muted-foreground/40 tabular-nums leading-4">
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

type HeaderItemProps = Omit<ComponentProps<typeof Button>, 'children' | 'command'> & {
  actions?: ReactNode
  /** When set, the button reveals this command's keyboard shortcut inline on hover. */
  command?: CommandId
  icon?: ReactNode
  label: ReactNode
  ref?: Ref<HTMLButtonElement>
}

function HeaderItem({ actions, className, command, icon, label, ref, variant = 'ghost', ...props }: HeaderItemProps) {
  return (
    <div className="flex min-h-8 items-center gap-1">
      <Button
        ref={ref}
        variant={variant}
        className={cn(
          'group min-h-8 min-w-0 justify-start gap-1.5 rounded-lg py-1 text-sm shadow-none outline-none transition-all duration-150 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-1 focus-visible:ring-sidebar-ring [&_svg]:size-4 [&_svg]:shrink-0',
          icon ? 'px-1.5' : 'px-2.5',
          command ? 'w-full shrink' : 'flex-1',
          className
        )}
        {...props}>
        {icon && <ItemLeadingSlot>{icon}</ItemLeadingSlot>}
        <span className="min-w-0 flex-1 truncate text-left font-medium text-[13px] text-sidebar-foreground/70 leading-5 group-hover:text-foreground group-focus-visible:text-foreground">
          {label}
        </span>
        {command && <CommandHint command={command} />}
      </Button>
      {actions && <div className="flex shrink-0 items-center gap-1 text-foreground/70">{actions}</div>}
    </div>
  )
}

function HeaderActionButton({
  className,
  ref,
  size = 'icon-navbar',
  variant = 'ghost',
  ...props
}: HeaderActionButtonProps) {
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      className={cn(
        'text-foreground/70! leading-none hover:bg-muted hover:text-foreground! data-[state=open]:bg-muted data-[state=open]:text-foreground! [&_.lucide:not(.lucide-custom)]:text-current! [&_svg]:block [&_svg]:size-4!',
        className
      )}
      {...props}
    />
  )
}

function GroupHeaderActionButton({
  className,
  ref,
  size = null,
  variant = 'ghost',
  ...props
}: HeaderActionButtonProps) {
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      className={cn(
        'inline-flex size-6 min-h-6 min-w-6 shrink-0 items-center justify-center gap-0 rounded-md p-0 text-foreground/70! leading-none shadow-none hover:bg-muted hover:text-foreground! data-[state=open]:bg-muted data-[state=open]:text-foreground! [&_.lucide:not(.lucide-custom)]:text-current! [&_svg]:block [&_svg]:size-3! [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

type SectionToggleMenuItemProps = Omit<ComponentProps<typeof MenuItem>, 'label' | 'icon'> & {
  collapseIcon?: ReactNode
  collapseLabel: string
  expandIcon?: ReactNode
  expandLabel: string
  sectionId: string
}

function SectionToggleMenuItem({
  collapseIcon,
  collapseLabel,
  disabled,
  expandIcon,
  expandLabel,
  onClick,
  sectionId,
  ...props
}: SectionToggleMenuItemProps) {
  const actions = useResourceListActions()
  const view = useResourceListView()
  const section = view.sections.find((candidate) => candidate.section.id === sectionId)
  const groupIds = section?.groups.map((group) => group.group.id) ?? []
  const expandGroupIds = section ? [section.section.id, ...groupIds] : groupIds
  const expandedGroupIds = section?.groups.filter((group) => !group.collapsed).map((group) => group.group.id) ?? []
  const hasExpandedGroup = expandedGroupIds.length > 0
  const isDisabled = disabled || groupIds.length === 0

  return (
    <MenuItem
      icon={hasExpandedGroup ? collapseIcon : expandIcon}
      label={hasExpandedGroup ? collapseLabel : expandLabel}
      disabled={isDisabled}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || isDisabled) return

        if (hasExpandedGroup) {
          actions.collapseGroups(expandedGroupIds)
        } else {
          actions.expandGroups(expandGroupIds)
        }
      }}
      {...props}
    />
  )
}

type SectionCollapseActionButtonProps = Omit<HeaderActionButtonProps, 'children'> & {
  alwaysVisible?: boolean
  label: string
  sectionId: string
}

function SectionCollapseActionButton({
  alwaysVisible,
  disabled,
  label,
  onClick,
  sectionId,
  type = 'button',
  ...props
}: SectionCollapseActionButtonProps) {
  void alwaysVisible
  const actions = useResourceListActions()
  const view = useResourceListView()
  const section = view.sections.find((candidate) => candidate.section.id === sectionId)
  const groupIds = section?.groups.filter((group) => !group.collapsed).map((group) => group.group.id) ?? []
  const isDisabled = disabled || groupIds.length === 0

  return (
    <Tooltip title={label} delay={500}>
      <GroupHeaderActionButton
        type={type}
        aria-label={props['aria-label'] ?? label}
        disabled={isDisabled}
        onClick={(event) => {
          event.stopPropagation()
          onClick?.(event)
          if (event.defaultPrevented || isDisabled) return
          actions.collapseGroups(groupIds)
        }}
        {...props}>
        <SquareMinus className="block" />
      </GroupHeaderActionButton>
    </Tooltip>
  )
}

type FilterBarProps = ComponentProps<'div'> & {
  ref?: Ref<HTMLDivElement>
}

function FilterBar({ className, ref, ...props }: FilterBarProps) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const state = useResourceListControlsState()

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

type ItemProps<T extends ResourceListItemBase> = ComponentProps<'div'> & {
  item: T
  ref?: Ref<HTMLDivElement>
}

function Item<T extends ResourceListItemBase>({
  item,
  className,
  ref,
  id: elementId,
  onClick,
  onKeyDown,
  onMouseEnter,
  onMouseLeave,
  tabIndex,
  ...props
}: ItemProps<T>) {
  const actions = useResourceListActions()
  const { getItemId } = useResourceListItemAccessors<T>()
  const id = getItemId(item)
  const rowState = useResourceListRowState(id)

  return (
    <div
      ref={ref}
      id={elementId ?? getResourceListOptionDomId(id)}
      role="option"
      aria-selected={rowState.selected}
      data-active-descendant={rowState.active || undefined}
      data-selected={rowState.selected || undefined}
      data-reveal-focus={rowState.revealFocused || undefined}
      data-dragging={rowState.dragging || undefined}
      tabIndex={tabIndex ?? -1}
      className={cn(
        'group relative flex w-full cursor-pointer items-center gap-1.5 px-2.5 text-[13px] text-sidebar-foreground/80 outline-none transition-all duration-150 has-[[data-resource-list-leading-slot=true]]:px-1.5',
        RESOURCE_LIST_VISUAL_ROW_CLASS,
        RESOURCE_LIST_INTERACTIVE_ROW_CLASS,
        rowState.active && !rowState.selected && 'bg-sidebar-accent text-sidebar-foreground',
        rowState.selected && RESOURCE_LIST_SELECTED_ROW_CLASS,
        rowState.revealFocused && 'animation-resource-list-reveal-focus',
        className
      )}
      onClick={(event) => {
        actions.selectItem(id)
        onClick?.(event)
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.target !== event.currentTarget) return

        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault()
          event.currentTarget.click()
        }
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
      }}
      onMouseLeave={(event) => {
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

function RenameField<T extends ResourceListItemBase>({
  item,
  className,
  ref,
  onPointerDown,
  ...props
}: RenameFieldProps<T>) {
  const actions = useResourceListActions()
  const { getItemId, getItemLabel } = useResourceListItemAccessors<T>()
  const id = getItemId(item)
  const rowState = useResourceListRowState(id)
  const didCommitRef = useRef(false)
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ;(ref as { current: HTMLInputElement | null }).current = node
      }
    },
    [ref]
  )

  useEffect(() => {
    if (!rowState.renaming) {
      didCommitRef.current = false
    }
  }, [rowState.renaming])

  const commitRename = (name: string) => {
    if (didCommitRef.current) return
    didCommitRef.current = true
    actions.commitRename(id, name)
  }

  if (!rowState.renaming) return null

  return (
    <Input
      ref={setInputRef}
      defaultValue={getItemLabel(item)}
      className={cn(
        'h-6 flex-1 border-none bg-transparent px-0 text-[13px] text-sidebar-foreground/70 shadow-none focus-visible:ring-0',
        className
      )}
      onBlur={(event) => commitRename(event.currentTarget.value)}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          commitRename(event.currentTarget.value)
        }
        if (event.key === ' ' || event.key === 'Spacebar') {
          event.stopPropagation()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          didCommitRef.current = true
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
        'min-w-0 flex-1 truncate text-left font-normal text-[13px] text-sidebar-foreground/70 leading-5 group-hover:text-foreground group-focus-visible:text-foreground group-data-[selected=true]:font-medium group-data-[selected=true]:text-foreground',
        className
      )}
      {...props}
    />
  )
}

type ItemLeadingSlotProps = Omit<ResourceListLeadingSlotProps, 'variant'>

function ItemLeadingSlot(props: ItemLeadingSlotProps) {
  return <ResourceListLeadingSlot variant="item" {...props} />
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
        'pointer-events-none flex size-5 shrink-0 items-center justify-center rounded-lg text-foreground/70 opacity-0 transition-all duration-150 [&_svg]:size-3.5 [&_svg]:shrink-0',
        'hover:bg-accent hover:text-foreground',
        'focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
        'group-hover:pointer-events-auto group-hover:opacity-100 data-[deleting=true]:pointer-events-auto data-[deleting=true]:opacity-100',
        className
      )}
      {...props}
    />
  )
}

type ItemActionsProps = ComponentProps<'div'> & {
  active?: boolean
  ref?: Ref<HTMLDivElement>
}

function ItemActions({ active, className, ref, ...props }: ItemActionsProps) {
  return (
    <div
      ref={ref}
      data-active={active || undefined}
      data-resource-list-item-actions="true"
      className={cn(
        '-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 flex items-center gap-0 opacity-0 transition-opacity duration-150',
        'focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 data-[active=true]:pointer-events-auto data-[active=true]:opacity-100',
        className
      )}
      {...props}
    />
  )
}

type BodyProps<T extends ResourceListItemBase> = {
  draggable?: boolean
  emptyFallback?: ReactNode
  errorFallback?: ReactNode
  listRef?: Ref<HTMLDivElement>
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
  virtualClassName?: string
  /** Accessible name forwarded to the listbox scroller in both the plain and draggable paths. */
  ariaLabel?: string
}

function Body<T extends ResourceListItemBase>({
  draggable = false,
  emptyFallback,
  errorFallback,
  listRef,
  renderItem,
  virtualClassName,
  ariaLabel
}: BodyProps<T>) {
  const state = useResourceListControlsState()
  const view = useResourceListView<T>()

  if (state.status === 'loading') {
    return <LoadingState />
  }

  if (state.status === 'error') {
    return errorFallback ?? <ErrorState />
  }

  if (view.items.length === 0 && view.groups.length === 0 && view.sections.length === 0) {
    return emptyFallback ?? <EmptyState />
  }

  if (draggable) {
    return (
      <VirtualDraggableItems ref={listRef} className={virtualClassName} ariaLabel={ariaLabel} renderItem={renderItem} />
    )
  }

  return <VirtualItems ref={listRef} className={virtualClassName} ariaLabel={ariaLabel} renderItem={renderItem} />
}

type EmptyStateProps = ComponentProps<typeof UiEmptyState>

function EmptyState(props: EmptyStateProps) {
  return <UiEmptyState compact preset="no-resource" {...props} />
}

type LoadingStateProps = ComponentProps<'div'> & {
  ref?: Ref<HTMLDivElement>
}

const RESOURCE_LIST_LOADING_GROUPS = [
  { id: 'primary', headerWidth: 'w-20', itemWidths: ['w-36', 'w-28', 'w-32'] },
  { id: 'secondary', headerWidth: 'w-16', itemWidths: ['w-32', 'w-24'] }
] as const

function LoadingState({ className, ref, ...props }: LoadingStateProps) {
  return (
    <div ref={ref} className={cn('flex flex-col px-1 py-1.5', className)} {...props}>
      {RESOURCE_LIST_LOADING_GROUPS.map((group) => (
        <div key={group.id} data-resource-list-loading-group="true" className="flex flex-col pb-1">
          <div
            data-resource-list-loading-group-header="true"
            className={cn('flex items-center gap-1.5 px-1.5 pt-2 pb-1', RESOURCE_LIST_ROW_HEIGHT_CLASS)}>
            <ResourceListLeadingSlot variant="loading">
              <Skeleton data-slot="skeleton" className="size-5 shrink-0 rounded-md" />
            </ResourceListLeadingSlot>
            <Skeleton data-slot="skeleton" className={cn('h-3 rounded-sm', group.headerWidth)} />
          </div>
          {group.itemWidths.map((width, index) => (
            <div
              key={`${group.id}-${index}`}
              data-resource-list-loading-item="true"
              className={cn(
                'mb-1.5 flex w-full items-center gap-1.5 px-1.5 last:mb-0',
                RESOURCE_LIST_VISUAL_ROW_CLASS
              )}>
              <ResourceListLeadingSlot variant="loading">
                <Skeleton data-slot="skeleton" className="size-5 shrink-0 rounded-md" />
              </ResourceListLeadingSlot>
              <Skeleton data-slot="skeleton" className={cn('h-3 rounded-sm', width)} />
              <Skeleton data-slot="skeleton" className="ml-auto size-5 shrink-0 rounded-md opacity-60" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

type ErrorStateProps = ComponentProps<'div'> & {
  message?: ReactNode
  ref?: Ref<HTMLDivElement>
}

function ErrorState({ className, message, ref, children, ...props }: ErrorStateProps) {
  const { t } = useTranslation()

  return (
    <div
      ref={ref}
      role="alert"
      className={cn('m-2 rounded-md border border-destructive/40 p-3 text-sm', className)}
      {...props}>
      {message ?? children ?? t('error.boundary.default.message')}
    </div>
  )
}

const ResourceList = {
  Provider: ResourceListProvider,
  Frame,
  Header,
  HeaderActionButton,
  GroupHeaderActionButton,
  SectionCollapseActionButton,
  SectionToggleMenuItem,
  HeaderItem,
  Search,
  FilterBar,
  GroupHeader,
  GroupShowMore,
  Body,
  VirtualItems,
  VirtualDraggableItems,
  Item,
  ItemAction,
  ItemActions,
  ItemLeadingSlot,
  ItemTitle,
  RenameField,
  EmptyState,
  LoadingState,
  ErrorState
}

export {
  ResourceList,
  useResourceList,
  useResourceListActions,
  useResourceListControlsState,
  useResourceListGroupState,
  useResourceListItemAccessors,
  useResourceListMeta,
  useResourceListRowState,
  useResourceListView
}
