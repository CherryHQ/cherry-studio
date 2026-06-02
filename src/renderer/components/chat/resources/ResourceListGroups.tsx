import { ContextMenu as UiContextMenu, ContextMenuTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { ComponentProps, MouseEvent, ReactNode, Ref } from 'react'
import { Fragment, isValidElement, useCallback, useState } from 'react'

import {
  type ResourceListGroup,
  type ResourceListItemBase,
  type ResourceListSection,
  useResourceListActions,
  useResourceListGroupState,
  useResourceListMeta,
  useResourceListView
} from './ResourceListContext'
import {
  RESOURCE_LIST_INTERACTIVE_ROW_CLASS,
  RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS,
  RESOURCE_LIST_ROW_HEIGHT_CLASS,
  RESOURCE_LIST_SELECTED_ROW_CLASS,
  RESOURCE_LIST_TEXT_START_PADDING_CLASS,
  RESOURCE_LIST_VISUAL_ROW_CLASS
} from './resourceListLayout'
import { ResourceListLeadingSlot } from './ResourceListLeadingSlot'

const EMPTY_GROUP_HEADER_ITEMS: ResourceListItemBase[] = []
const GROUP_HEADER_CONTEXT_MENU_GROUP_ID_ATTR = 'data-resource-list-group-context-menu-id'
const GROUP_HEADER_CONTEXT_MENU_GROUP_ID_SELECTOR = `[${GROUP_HEADER_CONTEXT_MENU_GROUP_ID_ATTR}]`

function stopEventPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

export function ResourceListGroupHeaderContextMenuOwner({ children }: { children: ReactNode }) {
  const meta = useResourceListMeta()
  const { getGroupHeaderContextMenu, groups } = meta
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const activeGroup = activeGroupId ? (groups.find((group) => group.id === activeGroupId) ?? null) : null
  const activeContextMenu = activeGroup ? getGroupHeaderContextMenu?.(activeGroup) : null
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setActiveGroupId(null)
  }, [])
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || !getGroupHeaderContextMenu) return

      const target = event.target instanceof Element ? event.target : null
      const groupElement = target?.closest<HTMLElement>(GROUP_HEADER_CONTEXT_MENU_GROUP_ID_SELECTOR)
      if (!groupElement || !event.currentTarget.contains(groupElement)) {
        event.preventDefault()
        return
      }

      const groupId = groupElement.dataset.resourceListGroupContextMenuId
      const group = groupId ? groups.find((candidate) => candidate.id === groupId) : null
      if (!group || !getGroupHeaderContextMenu(group)) {
        event.preventDefault()
        return
      }

      setActiveGroupId(group.id)
    },
    [getGroupHeaderContextMenu, groups]
  )

  if (!getGroupHeaderContextMenu) {
    return <>{children}</>
  }

  return (
    <UiContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <div className="contents" onContextMenu={handleContextMenu}>
          {children}
        </div>
      </ContextMenuTrigger>
      {activeGroup && activeContextMenu ? <Fragment key={activeGroup.id}>{activeContextMenu}</Fragment> : null}
    </UiContextMenu>
  )
}

type GroupHeaderProps = ComponentProps<'div'> & {
  group: ResourceListGroup
  ref?: Ref<HTMLDivElement>
}

type SectionHeaderProps = ComponentProps<'div'> & {
  section: ResourceListSection
  ref?: Ref<HTMLDivElement>
}

export function SectionHeader({ section, className, ref, style, ...props }: SectionHeaderProps) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const sectionState = useResourceListGroupState(section.id)
  const collapsed = sectionState.collapsed
  const sectionHeaderAction = meta.getSectionHeaderAction?.(section)
  const sectionHeaderActionAlwaysVisible =
    isValidElement<{ alwaysVisible?: boolean }>(sectionHeaderAction) && sectionHeaderAction.props.alwaysVisible === true

  if (!section.label) return null

  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        'group/resource-list-section flex w-full items-end px-0.5 pb-[2px]',
        RESOURCE_LIST_ROW_HEIGHT_CLASS,
        className
      )}
      {...props}>
      <div className="flex h-9 w-full items-center gap-1 px-1.5 text-muted-foreground">
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:text-foreground"
          onClick={() => actions.toggleGroup(section.id)}>
          <span className="min-w-0 truncate text-left font-semibold text-[13px] text-inherit leading-5">
            {section.label}
          </span>
        </button>
        {sectionHeaderAction && (
          <div
            className={cn(
              'ml-auto flex shrink-0 items-center transition-opacity',
              sectionHeaderActionAlwaysVisible
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover/resource-list-section:pointer-events-auto group-hover/resource-list-section:opacity-100'
            )}>
            {sectionHeaderAction}
          </div>
        )}
      </div>
    </div>
  )
}

export function GroupHeader({ group, className, ref, style, onContextMenu, ...props }: GroupHeaderProps) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const view = useResourceListView()
  const groupState = useResourceListGroupState(group.id)
  const viewGroup = view.groups.find((candidate) => candidate.group.id === group.id)
  const collapsed = groupState.collapsed
  const groupItems = viewGroup?.allItems ?? EMPTY_GROUP_HEADER_ITEMS
  const clickBehavior = meta.getGroupHeaderClickBehavior(group)
  const selected = clickBehavior === 'select-first-then-toggle' && groupState.selected
  const groupHeaderContext = { collapsed }
  const groupHeaderAction = meta.getGroupHeaderAction?.(group)
  const groupHeaderContextMenu = meta.getGroupHeaderContextMenu?.(group)
  const groupHeaderLeadingAction = meta.getGroupHeaderLeadingAction?.(group, groupHeaderContext)
  const customGroupHeaderIcon = meta.getGroupHeaderIcon?.(group, groupHeaderContext)
  const groupHeaderClassName = meta.getGroupHeaderClassName?.(group)
  const groupHeaderTooltip = meta.getGroupHeaderTooltip?.(group)
  const groupHeaderIcon = customGroupHeaderIcon ?? null
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      onContextMenu?.(event)
    },
    [onContextMenu]
  )
  const handleClick = useCallback(() => {
    if (clickBehavior === 'select-first-then-toggle' && !selected) {
      const firstItem = groupItems[0]
      if (firstItem) {
        actions.selectGroupHeaderItem(meta.getItemId(firstItem))
        return
      }

      if (meta.onEmptyGroupHeaderClick) {
        const handled = meta.onEmptyGroupHeaderClick(group)
        if (handled !== false) return
      }
    }

    actions.toggleGroup(group.id)
  }, [actions, clickBehavior, group, group.id, groupItems, meta, selected])

  if (!group.label) return null
  const header = (
    <div
      ref={ref}
      style={style}
      className={cn(
        'group/resource-list-group flex w-full items-center text-foreground text-sm',
        RESOURCE_LIST_ROW_HEIGHT_CLASS,
        className
      )}
      data-selected={selected || undefined}
      data-resource-list-group-context-menu-id={groupHeaderContextMenu ? group.id : undefined}
      onContextMenu={handleContextMenu}
      {...props}>
      <div
        title={groupHeaderTooltip}
        className={cn(
          'flex w-full items-center gap-1.5 px-1.5 transition-colors duration-150',
          RESOURCE_LIST_VISUAL_ROW_CLASS,
          RESOURCE_LIST_INTERACTIVE_ROW_CLASS,
          selected && RESOURCE_LIST_SELECTED_ROW_CLASS,
          groupHeaderClassName
        )}>
        {groupHeaderLeadingAction && (
          <div
            className={RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS}
            onClick={stopEventPropagation}
            onContextMenu={stopEventPropagation}
            onPointerDown={stopEventPropagation}
            onPointerUp={stopEventPropagation}>
            {groupHeaderLeadingAction}
          </div>
        )}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-current={selected ? 'true' : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-inherit outline-none"
          onClick={handleClick}>
          {groupHeaderIcon && (
            <ResourceListLeadingSlot aria-hidden="true" variant="groupHeader">
              {groupHeaderIcon}
            </ResourceListLeadingSlot>
          )}
          <span className="min-w-0 flex-1 truncate text-left font-medium text-[13px] text-inherit leading-5">
            {group.label}
          </span>
        </button>
        {groupHeaderAction && (
          <div
            className="pointer-events-none ml-auto flex shrink-0 items-center opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/resource-list-group:pointer-events-auto group-hover/resource-list-group:opacity-100"
            onClick={stopEventPropagation}
            onContextMenu={stopEventPropagation}
            onPointerDown={stopEventPropagation}
            onPointerUp={stopEventPropagation}>
            {groupHeaderAction}
          </div>
        )}
      </div>
    </div>
  )

  return header
}

type GroupShowMoreProps = ComponentProps<'div'> & {
  groupId: string
  ref?: Ref<HTMLDivElement>
}

export function GroupShowMore({ groupId, className, ref, style, ...props }: GroupShowMoreProps) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const groupState = useResourceListGroupState(groupId)
  const canCollapseToDefault = groupState.canCollapseToDefault
  const label = canCollapseToDefault ? meta.groupCollapseLabel : meta.groupShowMoreLabel

  if (!label) return null

  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        'flex items-center justify-start pr-1.5 text-foreground',
        RESOURCE_LIST_ROW_HEIGHT_CLASS,
        RESOURCE_LIST_TEXT_START_PADDING_CLASS,
        className
      )}
      {...props}>
      <button
        type="button"
        className="flex h-5 min-w-0 items-center justify-start rounded-sm px-0 text-left font-medium text-[11px] text-inherit leading-4 transition-colors duration-150 hover:text-muted-foreground/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        onClick={() => {
          if (canCollapseToDefault) {
            actions.collapseGroupItems(groupId)
            return
          }
          actions.showMoreInGroup(groupId)
        }}>
        {label}
      </button>
    </div>
  )
}
