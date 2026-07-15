import { CommandContextMenu } from '@renderer/components/command'
import { cn } from '@renderer/utils/style'
import { ChevronRight } from 'lucide-react'
import type { ComponentProps, MouseEvent, ReactNode, Ref } from 'react'
import { isValidElement, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

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

function stopEventPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

/**
 * A pass-through wrapper — group-header context menus are scoped to each
 * {@link GroupHeader} via its own {@link CommandContextMenu} so that right-clicks
 * on row items below the header are not intercepted.
 */
export function ResourceListGroupHeaderContextMenuOwner({ children }: { children: ReactNode }) {
  return <>{children}</>
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
        'group/resource-list-section flex w-full items-center text-foreground text-sm',
        RESOURCE_LIST_ROW_HEIGHT_CLASS,
        className
      )}
      {...props}>
      <div
        className={cn(
          'flex w-full items-center gap-1.5 px-2.5 text-muted-foreground transition-colors duration-150',
          RESOURCE_LIST_VISUAL_ROW_CLASS,
          RESOURCE_LIST_INTERACTIVE_ROW_CLASS
        )}>
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-inherit outline-none focus-visible:text-foreground"
          onClick={() => actions.toggleGroup(section.id)}>
          <span className="min-w-0 truncate text-left font-semibold text-[13px] text-inherit leading-5">
            {section.label}
          </span>
          <ChevronRight
            aria-hidden="true"
            size={11}
            className="hidden shrink-0 text-muted-foreground/60 transition-transform duration-150 group-focus-within/resource-list-section:block group-hover/resource-list-section:block"
            style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }}
          />
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
  const { t } = useTranslation()
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const view = useResourceListView()
  const groupState = useResourceListGroupState(group.id)
  const viewGroup = view.groups.find((candidate) => candidate.group.id === group.id)
  const collapsed = groupState.collapsed
  const groupItems = viewGroup?.allItems ?? EMPTY_GROUP_HEADER_ITEMS
  const clickBehavior = meta.getGroupHeaderClickBehavior(group)
  const isCollapsible = clickBehavior !== 'none'
  const selected = clickBehavior === 'select-first-then-toggle' && groupState.selected
  const groupHeaderContext = { collapsed }
  const groupHeaderAction = meta.getGroupHeaderAction?.(group)
  const groupHeaderContextMenu = meta.getGroupHeaderContextMenu?.(group)
  const groupHeaderLeadingAction = meta.getGroupHeaderLeadingAction?.(group, groupHeaderContext)
  const customGroupHeaderIcon = meta.getGroupHeaderIcon?.(group, groupHeaderContext)
  const groupHeaderClassName = meta.getGroupHeaderClassName?.(group)
  const groupHeaderTooltip = meta.getGroupHeaderTooltip?.(group)
  const groupHeaderIcon = customGroupHeaderIcon ?? null
  const hasLeadingSlot = Boolean(groupHeaderIcon || groupHeaderLeadingAction)
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      onContextMenu?.(event)
    },
    [onContextMenu]
  )
  const handleClick = useCallback(async () => {
    if (!isCollapsible) return

    if (clickBehavior === 'expand-only') {
      actions.expandGroups([group.id])
      return
    }

    if (clickBehavior === 'select-first-then-toggle' && !selected) {
      const firstItem = groupItems[0]
      if (firstItem) {
        actions.selectGroupHeaderItem(meta.getItemId(firstItem))
        return
      }

      if (await actions.selectGroupHeader(group.id)) return

      if (meta.onEmptyGroupHeaderClick) {
        const handled = await meta.onEmptyGroupHeaderClick(group)
        if (handled !== false) return
      }
    }

    actions.toggleGroup(group.id)
  }, [actions, clickBehavior, group, groupItems, isCollapsible, meta, selected])

  // Lazy: ContextMenuContent stays empty until right-click — stopPropagated bubbles must not reveal items.
  const headerContextMenuItems =
    groupHeaderContextMenu && groupHeaderContextMenu.length > 0 ? groupHeaderContextMenu : null
  const resolveHeaderContextMenuItems = useCallback(() => headerContextMenuItems ?? [], [headerContextMenuItems])

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
      onContextMenu={handleContextMenu}
      {...props}>
      <div
        title={groupHeaderTooltip}
        className={cn(
          'flex w-full items-center gap-1.5 transition-colors duration-150',
          hasLeadingSlot ? 'px-1.5' : 'px-2.5',
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
        {isCollapsible ? (
          <>
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-current={selected ? 'true' : undefined}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-inherit outline-none"
              onClick={() => void handleClick().catch(() => undefined)}>
              {groupHeaderIcon && (
                <ResourceListLeadingSlot aria-hidden="true" variant="groupHeader">
                  {groupHeaderIcon}
                </ResourceListLeadingSlot>
              )}
              <span className="min-w-0 truncate text-left font-medium text-[13px] text-inherit leading-5">
                {group.label}
              </span>
              {clickBehavior !== 'expand-only' && (
                <ChevronRight
                  aria-hidden="true"
                  size={11}
                  className="hidden shrink-0 text-muted-foreground/60 transition-transform duration-150 group-focus-within/resource-list-group:block group-hover/resource-list-group:block group-has-data-[state=open]/resource-list-group:block"
                  style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }}
                />
              )}
            </button>
            {clickBehavior === 'expand-only' && (
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-label={`${t(collapsed ? 'common.expand' : 'common.collapse')}: ${group.label}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                onClick={() => actions.toggleGroup(group.id)}>
                <ChevronRight
                  aria-hidden="true"
                  size={11}
                  className="transition-transform duration-150"
                  style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }}
                />
              </button>
            )}
          </>
        ) : (
          <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-inherit">
            {groupHeaderIcon && (
              <ResourceListLeadingSlot aria-hidden="true" variant="groupHeader">
                {groupHeaderIcon}
              </ResourceListLeadingSlot>
            )}
            <span className="min-w-0 truncate text-left font-medium text-[13px] text-inherit leading-5">
              {group.label}
            </span>
          </div>
        )}
        {groupHeaderAction && (
          <div
            className="pointer-events-none ml-auto flex shrink-0 items-center opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-focus-within/resource-list-group:pointer-events-auto group-focus-within/resource-list-group:opacity-100 group-hover/resource-list-group:pointer-events-auto group-hover/resource-list-group:opacity-100 has-data-[state=open]:pointer-events-auto has-data-[state=open]:opacity-100"
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

  if (!headerContextMenuItems) return header

  return (
    <CommandContextMenu location="webcontents.context" getExtraItems={resolveHeaderContextMenuItems}>
      {header}
    </CommandContextMenu>
  )
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
  const isLoading = groupState.status === 'loading'
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
        aria-busy={isLoading || undefined}
        data-error={groupState.status === 'error' || undefined}
        disabled={isLoading}
        className="flex h-5 min-w-0 items-center justify-start rounded-sm px-0 text-left font-medium text-[11px] text-muted-foreground/55 leading-4 transition-colors duration-150 hover:text-inherit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        onClick={() => {
          if (canCollapseToDefault) {
            actions.collapseGroupItems(groupId)
            return
          }
          void actions.showMoreInGroup(groupId).catch(() => undefined)
        }}>
        {label}
      </button>
    </div>
  )
}
