import { Tooltip } from '@cherrystudio/ui'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import { CommandPopupMenu } from '@renderer/components/command'
import ConfirmActionPopup from '@renderer/components/popups/ConfirmActionPopup'
import { cn } from '@renderer/utils/style'
import { History, MoreHorizontal } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ConversationResourceMenu,
  type ConversationResourceMenuItem,
  ResourceList,
  type ResourceListGroup,
  type ResourceListReorderPayload,
  type ResourceListSection,
  type ResourceListStatus
} from './base'

export type ResourceEntityRailItem = {
  id: string
  name: string
  icon?: ReactNode
  orderKey?: string
  reorderable?: boolean
  /**
   * When true, a *visible* entity floats into the "已固定" section at the top and cannot be dragged.
   * It does not affect visibility — an entity with no resources stays hidden whether pinned or not.
   */
  pinned?: boolean
  /** Single user tag name. Only consulted when the rail runs with `groupByTag`; undefined → "未分组". */
  tag?: string
  trailingAction?: ReactNode
}

// Pinned entities float into a "已固定" section at the top; the rest sit under the "助手" / "智能体"
// section below. We use SECTION headers (not group headers) so the labels stay flush-left while the
// entity rows keep their avatar and read as indented beneath — matching the modern layout's left list.
// Each section also gets its own (header-less) group id so drag-reorder never crosses the boundary.
const ENTITY_RAIL_PINNED_SECTION_ID = 'resource-entity-rail:section:pinned'
const ENTITY_RAIL_DEFAULT_SECTION_ID = 'resource-entity-rail:section:default'
const ENTITY_RAIL_PINNED_GROUP_ID = 'resource-entity-rail:group:pinned'
const ENTITY_RAIL_DEFAULT_GROUP_ID = 'resource-entity-rail:group:default'
// When `groupByTag` is on, each tag name becomes its own collapsible section below the pinned one;
// untagged entities collapse together under a distinct internal bucket.
const ENTITY_RAIL_TAG_SECTION_PREFIX = 'resource-entity-rail:section:'
const ENTITY_RAIL_TAG_GROUP_PREFIX = 'resource-entity-rail:group:'
const ENTITY_RAIL_UNTAGGED_KEY = JSON.stringify(['untagged'])

function getEntityRailTagBucketKey(tag: string | undefined) {
  return tag ? JSON.stringify(['tag', tag]) : ENTITY_RAIL_UNTAGGED_KEY
}

function getEntityRailTagGroupingRank(item: ResourceEntityRailItem) {
  if (item.pinned) return 0
  return item.tag ? 2 : 1
}

function sortEntityRailItemsForTagGrouping<T extends ResourceEntityRailItem>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index, rank: getEntityRailTagGroupingRank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)
}

export type ResourceEntityRailProps<T extends ResourceEntityRailItem, TActionContext = unknown> = {
  addIcon?: ReactNode
  addLabel: string
  ariaLabel: string
  /** Header for the non-pinned group ("助手" for assistants, "智能体" for agents). */
  defaultGroupLabel?: string
  /**
   * Group the non-pinned entities by their `tag` into collapsible sections (the pinned section stays
   * on top). Drag-reorder still updates the flat orderKey; it does not change the entity tag.
   * Off → the flat "助手"/"智能体" section.
   */
  groupByTag?: boolean
  emptyFallback?: ReactNode
  getContextMenuActions?: (item: T) => readonly ResolvedAction<TActionContext>[]
  headerActions?: ReactNode
  historyRecordsActive?: boolean
  listRef?: RefObject<HTMLDivElement | null>
  onAdd: () => void | Promise<void>
  /** When provided, a history-records button sits next to the add button. */
  onOpenHistoryRecords?: () => void
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  onContextMenuAction?: (item: T, action: ResolvedAction<TActionContext>) => void | Promise<void>
  onReorder?: (payload: ResourceListReorderPayload) => void | Promise<void>
  onSelect: (item: T) => void | Promise<void>
  onSelectedClick?: (item: T) => void | Promise<void>
  selectedClickId?: string | null
  selectedId?: string | null
  status?: ResourceListStatus
  variant: 'agent' | 'assistant'
  items: readonly T[]
}

const ENTITY_RAIL_LEADING_SLOT_CLASS =
  'text-foreground group-hover:text-inherit group-focus-visible:text-inherit group-data-[selected=true]:text-inherit'

const ENTITY_RAIL_TITLE_CLASS =
  'font-medium text-foreground group-hover:text-inherit group-focus-visible:text-inherit group-data-[selected=true]:text-inherit'

function getEntityRailTrailingActionPaddingClassName(actionCount: number) {
  if (actionCount >= 3) {
    return 'group-focus-within:pr-16 group-hover:pr-16 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-16'
  }
  if (actionCount === 2) {
    return 'group-focus-within:pr-12 group-hover:pr-12 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-12'
  }
  if (actionCount === 1) {
    return 'group-focus-within:pr-7 group-hover:pr-7 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-7'
  }
  return ''
}

export function ResourceEntityRail<T extends ResourceEntityRailItem, TActionContext = unknown>({
  addIcon,
  addLabel,
  ariaLabel,
  defaultGroupLabel,
  groupByTag = false,
  emptyFallback,
  getContextMenuActions,
  headerActions,
  historyRecordsActive = false,
  listRef,
  onAdd,
  onOpenHistoryRecords,
  resourceMenuItems,
  onContextMenuAction,
  onReorder,
  onSelect,
  onSelectedClick,
  selectedClickId,
  selectedId,
  status = 'idle',
  variant,
  items
}: ResourceEntityRailProps<T, TActionContext>) {
  const { t } = useTranslation()
  const reorderEnabled = !!onReorder
  const fallbackListRef = useRef<HTMLDivElement>(null)
  const effectiveListRef = listRef ?? fallbackListRef
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const hasActiveCenterSurface = hasActiveResourceMenuItem || historyRecordsActive
  const effectiveSelectedId = hasActiveCenterSurface ? null : selectedId
  const effectiveSelectedClickId = hasActiveResourceMenuItem ? null : (selectedClickId ?? selectedId)
  const handleItemClick = useCallback(
    (item: T) => {
      if (effectiveSelectedClickId === item.id && onSelectedClick) {
        void onSelectedClick(item)
        return
      }
      void onSelect(item)
    },
    [effectiveSelectedClickId, onSelect, onSelectedClick]
  )
  // Keyboard activation (Enter/Space) goes through the list's `selectItem` action, not the row's
  // onClick, so route it back through `handleItemClick` to keep keyboard and mouse in sync —
  // including the "activate the already-selected entity to toggle its pane" behavior.
  const handleSelectItemById = useCallback(
    (id: string) => {
      const item = items.find((entry) => entry.id === id)
      if (item) handleItemClick(item)
    },
    [handleItemClick, items]
  )
  const runContextMenuAction = useCallback(
    async (item: T, action: ResolvedAction<TActionContext>) => {
      if (!action.availability.enabled || !onContextMenuAction) return

      const confirm = action.confirm
      if (confirm) {
        // Confirm gates a fallible action: ConfirmActionPopup runs it in-dialog and
        // surfaces failures (toast + retry), so a rejected action is never silent.
        await ConfirmActionPopup.show({
          title: confirm.title,
          content: confirm.description ?? confirm.content,
          okText: confirm.confirmText,
          cancelText: confirm.cancelText,
          danger: confirm.destructive,
          action: () => onContextMenuAction(item, action)
        })
        return
      }

      await onContextMenuAction(item, action)
    },
    [onContextMenuAction]
  )
  const renderItem = useCallback(
    (item: T) => {
      const actions = getContextMenuActions?.(item) ?? []
      const hasVisibleMenuActions = !!onContextMenuAction && actions.some((action) => action.availability.visible)
      const hasTrailingAction = Boolean(item.trailingAction)
      const trailingActionCount = (hasTrailingAction ? 1 : 0) + (hasVisibleMenuActions ? 1 : 0)
      const trailingActionPaddingClassName = getEntityRailTrailingActionPaddingClassName(trailingActionCount)
      const extraItems = hasVisibleMenuActions
        ? actionsToCommandMenuExtraItems(actions, (action) => runContextMenuAction(item, action))
        : []
      // No row onClick: selection for mouse, row-Enter, and listbox-keyboard all funnel through
      // the list's selectItem action → onSelectItem (handleSelectItemById → handleItemClick), so
      // every path stays consistent and fires exactly once.
      const row = (
        <ResourceList.Item item={item} data-testid="resource-entity-rail-row">
          {item.icon && (
            <ResourceList.ItemLeadingSlot className={ENTITY_RAIL_LEADING_SLOT_CLASS}>
              {item.icon}
            </ResourceList.ItemLeadingSlot>
          )}
          <ResourceList.ItemTitle
            className={cn(ENTITY_RAIL_TITLE_CLASS, 'transition-[padding]', trailingActionPaddingClassName)}
            title={item.name}>
            {item.name}
          </ResourceList.ItemTitle>
          {(hasTrailingAction || hasVisibleMenuActions) && (
            // Stop clicks bubbling to the row's onClick: the "more" menu portals its content out of
            // the DOM but React still routes the menu-item click up the React tree (…→ ItemActions →
            // row), which would otherwise select the entity when a menu action (e.g. edit) is picked.
            <ResourceList.ItemActions onClick={(event) => event.stopPropagation()}>
              {hasVisibleMenuActions && (
                <Tooltip title={t('common.more')} delay={500}>
                  <CommandPopupMenu location="webcontents.context" extraItems={extraItems} align="end" side="bottom">
                    <ResourceList.GroupHeaderActionButton
                      type="button"
                      aria-label={t('common.more')}
                      onClick={(event) => event.stopPropagation()}>
                      <MoreHorizontal className="block" />
                    </ResourceList.GroupHeaderActionButton>
                  </CommandPopupMenu>
                </Tooltip>
              )}
              {item.trailingAction}
            </ResourceList.ItemActions>
          )}
        </ResourceList.Item>
      )
      if (!actions.length || !onContextMenuAction) return row

      return (
        <ResourceListActionContextMenu
          key={item.id}
          item={item}
          actions={actions}
          onAction={(action) => onContextMenuAction(item, action)}>
          {row}
        </ResourceListActionContextMenu>
      )
    },
    [getContextMenuActions, onContextMenuAction, runContextMenuAction, t]
  )
  const empty = useMemo(() => emptyFallback ?? <div className="min-h-0 flex-1" />, [emptyFallback])
  const providerItems = useMemo(
    () => (groupByTag ? sortEntityRailItemsForTagGrouping(items) : items),
    [groupByTag, items]
  )
  // Collapsible sections matching the modern layout's left assistant/agent layout (minus the nested
  // topics/sessions): pinned entities float into "已固定" at the top, the rest sit under the
  // "助手" / "智能体" section below. Section headers stay flush-left; the entity rows keep their
  // avatar and read as indented beneath. The single-section case (nothing pinned) renders the flat
  // list with no header, exactly like the modern layout.
  const sectionBy = useMemo<(item: T) => ResourceListSection>(
    () => (item) => {
      if (item.pinned) return { id: ENTITY_RAIL_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
      if (groupByTag) {
        const tagBucketKey = getEntityRailTagBucketKey(item.tag)
        return item.tag
          ? { id: `${ENTITY_RAIL_TAG_SECTION_PREFIX}${tagBucketKey}`, label: item.tag }
          : { id: `${ENTITY_RAIL_TAG_SECTION_PREFIX}${tagBucketKey}`, label: t('assistants.tags.untagged') }
      }
      return { id: ENTITY_RAIL_DEFAULT_SECTION_ID, label: defaultGroupLabel ?? '' }
    },
    [defaultGroupLabel, groupByTag, t]
  )
  // Header-less groups (one per section, distinct ids) keep entity avatars visible and stop
  // drag-reorder from crossing the pinned/non-pinned (or per-tag) boundary.
  const groupBy = useMemo<(item: T) => ResourceListGroup>(
    () => (item) => {
      if (item.pinned) return { id: ENTITY_RAIL_PINNED_GROUP_ID, label: '' }
      if (groupByTag) {
        return { id: `${ENTITY_RAIL_TAG_GROUP_PREFIX}${getEntityRailTagBucketKey(item.tag)}`, label: '' }
      }
      return { id: ENTITY_RAIL_DEFAULT_GROUP_ID, label: '' }
    },
    [groupByTag]
  )

  // Alias the compound provider to a local before rendering — same pattern as TopicResourceList/SessionResourceList.
  // Written inline as `<ResourceList.Provider>` it gets auto-rewritten to `<ResourceList>` by the
  // React-19 "drop Context .Provider" lint fixer (ResourceList.Provider only looks like a Context).
  const Provider = ResourceList.Provider

  return (
    <Provider
      variant={variant}
      items={providerItems}
      selectedId={effectiveSelectedId}
      onSelectItem={handleSelectItemById}
      status={status}
      groupBy={groupBy}
      sectionBy={sectionBy}
      defaultGroupVisibleCount={Number.POSITIVE_INFINITY}
      dragCapabilities={{
        groups: false,
        items: reorderEnabled,
        itemSameGroup: reorderEnabled,
        itemCrossGroup: false
      }}
      canDragItem={({ item }) => reorderEnabled && item.reorderable !== false && !item.pinned}
      canDropItem={({ activeItem, sourceGroupId, targetGroupId }) =>
        reorderEnabled &&
        activeItem.reorderable !== false &&
        !activeItem.pinned &&
        targetGroupId !== ENTITY_RAIL_PINNED_GROUP_ID &&
        sourceGroupId === targetGroupId
      }
      onReorder={reorderEnabled ? onReorder : undefined}>
      <ResourceList.Frame className="h-full min-h-0" data-testid={`${variant}-entity-rail`}>
        <ResourceList.Header className="gap-1">
          <ResourceList.HeaderItem
            type="button"
            icon={addIcon}
            label={addLabel}
            aria-label={addLabel}
            onClick={() => void onAdd()}
            actions={
              headerActions || onOpenHistoryRecords ? (
                <>
                  {headerActions}
                  {onOpenHistoryRecords && (
                    <Tooltip title={t('history.records.shortTitle')} delay={500}>
                      <ResourceList.HeaderActionButton
                        type="button"
                        aria-label={t('history.records.shortTitle')}
                        aria-current={historyRecordsActive ? 'page' : undefined}
                        className={cn(historyRecordsActive && 'bg-muted text-foreground!')}
                        onClick={() => onOpenHistoryRecords()}>
                        <History className="block" />
                      </ResourceList.HeaderActionButton>
                    </Tooltip>
                  )}
                </>
              ) : undefined
            }
          />
          <ConversationResourceMenu items={resourceMenuItems} />
        </ResourceList.Header>
        <ResourceList.Body<T>
          listRef={effectiveListRef}
          draggable={reorderEnabled}
          ariaLabel={ariaLabel}
          virtualClassName="pt-1 pb-3"
          errorFallback={<ResourceList.ErrorState message={t('error.boundary.default.message')} />}
          emptyFallback={empty}
          renderItem={renderItem}
        />
      </ResourceList.Frame>
    </Provider>
  )
}
