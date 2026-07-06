import { Tooltip } from '@cherrystudio/ui'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import { CommandPopupMenu } from '@renderer/components/command'
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
  icon: ReactNode
  orderKey?: string
  /**
   * When true, a *visible* entity floats into the "已固定" section at the top and cannot be dragged.
   * It does not affect visibility — an entity with no resources stays hidden whether pinned or not.
   */
  pinned?: boolean
  /** Single user tag name. Only consulted when the rail runs with `groupByTag`; undefined → "未分组". */
  tag?: string
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
   * on top). Drag-reorder is disabled while on, since `orderKey` is a single flat order. Off → the
   * flat "助手"/"智能体" section.
   */
  groupByTag?: boolean
  emptyFallback?: ReactNode
  getContextMenuActions?: (item: T) => readonly ResolvedAction<TActionContext>[]
  listRef?: RefObject<HTMLDivElement | null>
  onAdd: () => void | Promise<void>
  /** When provided, a history-records button sits next to the add button. */
  onOpenHistoryRecords?: () => void
  resourceMenuItems?: readonly ConversationResourceMenuItem[]
  onContextMenuAction?: (item: T, action: ResolvedAction<TActionContext>) => void | Promise<void>
  onReorder?: (payload: ResourceListReorderPayload) => void | Promise<void>
  onSelect: (item: T) => void | Promise<void>
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
  listRef,
  onAdd,
  onOpenHistoryRecords,
  resourceMenuItems,
  onContextMenuAction,
  onReorder,
  onSelect,
  selectedId,
  status = 'idle',
  variant,
  items
}: ResourceEntityRailProps<T, TActionContext>) {
  const { t } = useTranslation()
  // Tag grouping splits the flat order across sections, so dragging an item between tags would have
  // no meaningful `orderKey` target — disable reorder entirely while grouping by tag.
  const reorderEnabled = !!onReorder && !groupByTag
  const fallbackListRef = useRef<HTMLDivElement>(null)
  const effectiveListRef = listRef ?? fallbackListRef
  const hasActiveResourceMenuItem = resourceMenuItems?.some((item) => item.active) ?? false
  const runContextMenuAction = useCallback(
    (item: T, action: ResolvedAction<TActionContext>) => {
      if (!action.availability.enabled || !onContextMenuAction) return

      const confirm = action.confirm
      if (confirm) {
        void window.modal.confirm({
          title: confirm.title,
          content: confirm.description ?? confirm.content,
          okText: confirm.confirmText,
          cancelText: confirm.cancelText,
          centered: true,
          okButtonProps: confirm.destructive ? { danger: true } : undefined,
          onOk: () => onContextMenuAction(item, action)
        })
        return
      }

      window.requestAnimationFrame(() => void onContextMenuAction(item, action))
    },
    [onContextMenuAction]
  )
  const renderItem = useCallback(
    (item: T) => {
      const actions = getContextMenuActions?.(item) ?? []
      const hasVisibleMenuActions = !!onContextMenuAction && actions.some((action) => action.availability.visible)
      const trailingActionCount = hasVisibleMenuActions ? 1 : 0
      const trailingActionPaddingClassName = getEntityRailTrailingActionPaddingClassName(trailingActionCount)
      const extraItems = hasVisibleMenuActions
        ? actionsToCommandMenuExtraItems(actions, (action) => runContextMenuAction(item, action))
        : []
      const row = (
        <ResourceList.Item item={item} data-testid="resource-entity-rail-row" onClick={() => void onSelect(item)}>
          <ResourceList.ItemLeadingSlot className={ENTITY_RAIL_LEADING_SLOT_CLASS}>
            {item.icon}
          </ResourceList.ItemLeadingSlot>
          <ResourceList.ItemTitle
            className={cn(ENTITY_RAIL_TITLE_CLASS, 'transition-[padding]', trailingActionPaddingClassName)}
            title={item.name}>
            {item.name}
          </ResourceList.ItemTitle>
          {hasVisibleMenuActions && (
            // Stop clicks bubbling to the row's onClick: the "more" menu portals its content out of
            // the DOM but React still routes the menu-item click up the React tree (…→ ItemActions →
            // row), which would otherwise select the entity when a menu action (e.g. edit) is picked.
            <ResourceList.ItemActions onClick={(event) => event.stopPropagation()}>
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
    [getContextMenuActions, onContextMenuAction, onSelect, runContextMenuAction, t]
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
      selectedId={hasActiveResourceMenuItem ? null : selectedId}
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
      canDragItem={({ item }) => reorderEnabled && !item.pinned}
      canDropItem={({ activeItem, targetGroupId }) =>
        reorderEnabled && !activeItem.pinned && targetGroupId !== ENTITY_RAIL_PINNED_GROUP_ID
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
              onOpenHistoryRecords ? (
                <Tooltip title={t('history.records.shortTitle')} delay={500}>
                  <ResourceList.HeaderActionButton
                    type="button"
                    aria-label={t('history.records.shortTitle')}
                    onClick={() => onOpenHistoryRecords()}>
                    <History className="block" />
                  </ResourceList.HeaderActionButton>
                </Tooltip>
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
