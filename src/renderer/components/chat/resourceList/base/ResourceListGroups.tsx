import { Tooltip } from '@cherrystudio/ui'
import { CommandContextMenu } from '@renderer/components/command'
import { cn } from '@renderer/utils/style'
import { ChevronRight } from 'lucide-react'
import type { ComponentProps, MouseEvent, ReactNode, Ref } from 'react'
import { isValidElement, useCallback, useEffect, useState } from 'react'
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
  RESOURCE_LIST_LABEL_CLASS,
  RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS,
  RESOURCE_LIST_ROW_HEIGHT_CLASS,
  RESOURCE_LIST_SELECTED_ROW_CLASS,
  RESOURCE_LIST_TEXT_START_PADDING_CLASS,
  RESOURCE_LIST_TITLE_FADE_CLASS,
  RESOURCE_LIST_VISUAL_ROW_CLASS
} from './resourceListLayout'
import { ResourceListLeadingSlot } from './ResourceListLeadingSlot'

const EMPTY_GROUP_HEADER_ITEMS: ResourceListItemBase[] = []

/**
 * The chevron slot: an action button's 24px footprint so the chevron lands on the hover actions'
 * rhythm when the title is long, with a pulled-in left margin that keeps it the same 6px from a
 * short title as the section-header chevron.
 */
const GROUP_HEADER_CHEVRON_SLOT_CLASS =
  '-ml-1.5 hidden size-6 shrink-0 items-center justify-center text-muted-foreground group-hover/resource-list-group:flex group-has-[:focus-visible]/resource-list-group:flex group-has-data-[state=open]/resource-list-group:flex'

function stopEventPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

/**
 * Group-header labels shrink to their text so the collapse chevron can sit right
 * after the name, which means the fade band would eat the tail of names that fit.
 * Measuring is the only way to tell: the label box shrinks below its text exactly
 * when the row runs out of room (sidebar resize, or the hover actions claiming
 * their reserve), and the observer catches both.
 */
function useLabelOverflow(label: string) {
  // A callback ref, not useRef: the label span lives in two different JSX branches (collapsible vs
  // not), so switching presentation swaps the node while `label` stays the same — a ref-only effect
  // would keep observing the detached node and freeze the fade in its old state.
  const [element, setElement] = useState<HTMLSpanElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    if (!element) return

    const measure = () => setOverflowing(element.scrollWidth - element.clientWidth > 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, label])

  return { overflowing, ref: setElement }
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
          <span className={cn('min-w-0 truncate text-left text-inherit', RESOURCE_LIST_LABEL_CLASS)}>
            {section.label}
          </span>
          <ChevronRight
            aria-hidden="true"
            size={14}
            className="hidden shrink-0 text-muted-foreground transition-transform duration-150 group-hover/resource-list-section:block group-has-[:focus-visible]/resource-list-section:block"
            style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }}
          />
        </button>
        {sectionHeaderAction && (
          <div
            className={cn(
              // The group-header cluster is absolutely placed at right-1.5; this one is in flow inside a
              // px-2.5 row, so it needs the 4px back to share that column.
              '-mr-1 ml-auto flex shrink-0 items-center transition-opacity',
              sectionHeaderActionAlwaysVisible
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 group-hover/resource-list-section:pointer-events-auto group-hover/resource-list-section:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100'
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
  const labelOverflow = useLabelOverflow(group.label)
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
  const isBucketHeader = meta.getGroupHeaderKind?.(group) === 'bucket'
  // An entity header stands in for the conversation it holds — but only while that row is off screen
  // (collapsed group, or trimmed away by show-more). When the row is rendered it carries the fill
  // itself, and two identical pills for one conversation read as two selections. A bucket header (a
  // folder, a time range, "unlinked agent") never stands in: it is a container, not the thing you
  // opened, so it keeps its own voice.
  const showsSelectedSurface = selected && !groupState.selectedVisible && !isBucketHeader
  const hasLeadingSlot = Boolean(groupHeaderIcon || groupHeaderLeadingAction)
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      onContextMenu?.(event)
    },
    [onContextMenu]
  )
  const handleClick = useCallback(() => {
    if (!isCollapsible) return

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
  }, [actions, clickBehavior, group, groupItems, isCollapsible, meta, selected])
  // Peeking at a group must not cost you the conversation you are in: on a header that would
  // otherwise switch away (`select-first-then-toggle`), the chevron is its own button that only
  // folds the group open or shut. Headers whose whole row already means "toggle" keep one button.
  const chevronIsOwnButton = clickBehavior === 'select-first-then-toggle'
  const handleChevronClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      actions.toggleGroup(group.id)
    },
    [actions, group.id]
  )

  // Lazy: ContextMenuContent stays empty until right-click — stopPropagated bubbles must not reveal items.
  const headerContextMenuItems =
    groupHeaderContextMenu && groupHeaderContextMenu.length > 0 ? groupHeaderContextMenu : null
  const resolveHeaderContextMenuItems = useCallback(() => headerContextMenuItems ?? [], [headerContextMenuItems])

  if (!group.label) return null
  // Type separates kinds of header, not click behaviour: rows naming a manageable entity (agent,
  // assistant, workdir — the ones carrying hover actions) read as list content, while structural
  // buckets (time ranges, pinned) take the same recessed typography as the section headers above
  // them, so the list has exactly two voices instead of three.
  const groupHeaderLabelClassName = cn(
    'min-w-0 overflow-hidden text-clip whitespace-nowrap text-left text-inherit',
    labelOverflow.overflowing && RESOURCE_LIST_TITLE_FADE_CLASS,
    RESOURCE_LIST_LABEL_CLASS,
    // The same weight an item row and the entity rail give a selected row: this header is standing
    // in for one, so it has to read identically.
    showsSelectedSurface && 'font-medium'
  )
  // The chevron trails the label and carries the same 24px footprint as an action button, so
  // reserving exactly the two action buttons parks it as a third icon in that rhythm — equal
  // spacing between the chevron, the more menu and the create action. The reserve sits on
  // whichever box holds the label, so the label shrinks and the chevron slides left with it.
  const groupHeaderActionYieldClassName = groupHeaderAction
    ? 'transition-[padding-right] duration-150 group-hover/resource-list-group:pr-12 group-has-[:focus-visible]/resource-list-group:pr-12 group-has-data-[state=open]/resource-list-group:pr-12'
    : undefined
  const chevron = (
    <ChevronRight
      size={14}
      className="transition-transform duration-150"
      style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }}
    />
  )
  const headerContent = (
    <div
      className={cn(
        'relative flex w-full items-center gap-1.5 transition-colors duration-150',
        hasLeadingSlot ? 'px-1.5' : 'px-2.5',
        RESOURCE_LIST_VISUAL_ROW_CLASS,
        RESOURCE_LIST_INTERACTIVE_ROW_CLASS,
        isBucketHeader && 'text-muted-foreground',
        showsSelectedSurface && RESOURCE_LIST_SELECTED_ROW_CLASS,
        isCollapsible && chevronIsOwnButton && groupHeaderActionYieldClassName,
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
      {isCollapsible && chevronIsOwnButton ? (
        <>
          <button
            type="button"
            aria-current={showsSelectedSurface ? 'true' : undefined}
            className="flex h-full min-w-0 items-center gap-1.5 text-left text-inherit outline-none"
            onClick={handleClick}>
            {groupHeaderIcon && (
              <ResourceListLeadingSlot aria-hidden="true" variant="groupHeader">
                {groupHeaderIcon}
              </ResourceListLeadingSlot>
            )}
            <span ref={labelOverflow.ref} className={groupHeaderLabelClassName}>
              {group.label}
            </span>
          </button>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t('common.expand') : t('common.collapse')}
            className={cn(GROUP_HEADER_CHEVRON_SLOT_CLASS, 'outline-none')}
            onClick={handleChevronClick}>
            {chevron}
          </button>
          {/* The rest of the row keeps the label button's reach — the same click, minus a second
              stop in the tab order and a duplicate name for screen readers. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="h-full flex-1 cursor-default"
            onClick={handleClick}
          />
        </>
      ) : isCollapsible ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-current={showsSelectedSurface ? 'true' : undefined}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-inherit outline-none',
            groupHeaderActionYieldClassName
          )}
          onClick={handleClick}>
          {groupHeaderIcon && (
            <ResourceListLeadingSlot aria-hidden="true" variant="groupHeader">
              {groupHeaderIcon}
            </ResourceListLeadingSlot>
          )}
          <span ref={labelOverflow.ref} className={groupHeaderLabelClassName}>
            {group.label}
          </span>
          <span aria-hidden="true" className={GROUP_HEADER_CHEVRON_SLOT_CLASS}>
            {chevron}
          </span>
        </button>
      ) : (
        <div
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-inherit',
            groupHeaderActionYieldClassName
          )}>
          {groupHeaderIcon && (
            <ResourceListLeadingSlot aria-hidden="true" variant="groupHeader">
              {groupHeaderIcon}
            </ResourceListLeadingSlot>
          )}
          <span ref={labelOverflow.ref} className={groupHeaderLabelClassName}>
            {group.label}
          </span>
        </div>
      )}
      {groupHeaderAction && (
        <div
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 flex items-center opacity-0 transition-opacity group-hover/resource-list-group:pointer-events-auto group-hover/resource-list-group:opacity-100 has-data-[state=open]:pointer-events-auto has-data-[state=open]:opacity-100 group-has-[:focus-visible]/resource-list-group:pointer-events-auto group-has-[:focus-visible]/resource-list-group:opacity-100"
          onClick={stopEventPropagation}
          onContextMenu={stopEventPropagation}
          onPointerDown={stopEventPropagation}
          onPointerUp={stopEventPropagation}>
          {groupHeaderAction}
        </div>
      )}
    </div>
  )
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
      {groupHeaderTooltip ? (
        <Tooltip content={groupHeaderTooltip} placement="right" sideOffset={4} delay={500} fullWidthTrigger>
          {headerContent}
        </Tooltip>
      ) : (
        headerContent
      )}
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
        className={cn(
          'flex h-5 min-w-0 items-center justify-start rounded-sm px-0 text-left text-foreground-tertiary transition-colors duration-150 hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground focus-visible:outline-none',
          RESOURCE_LIST_LABEL_CLASS
        )}
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
