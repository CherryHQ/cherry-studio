import { Tooltip } from '@cherrystudio/ui'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import {
  ResourceList,
  type ResourceListGroup,
  type ResourceListReorderPayload,
  type ResourceListSection,
  type ResourceListStatus
} from '@renderer/components/chat/resources'
import { CommandPopupMenu } from '@renderer/components/command'
import { cn } from '@renderer/utils/style'
import { History, MoreHorizontal } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

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
}

// Pinned entities float into a "已固定" section at the top; the rest sit under the "助手" / "智能体"
// section below. We use SECTION headers (not group headers) so the labels stay flush-left while the
// entity rows keep their avatar and read as indented beneath — matching the efficiency view's left list.
// Each section also gets its own (header-less) group id so drag-reorder never crosses the boundary.
const ENTITY_RAIL_PINNED_SECTION_ID = 'resource-entity-rail:section:pinned'
const ENTITY_RAIL_DEFAULT_SECTION_ID = 'resource-entity-rail:section:default'
const ENTITY_RAIL_PINNED_GROUP_ID = 'resource-entity-rail:group:pinned'
const ENTITY_RAIL_DEFAULT_GROUP_ID = 'resource-entity-rail:group:default'

export type ResourceEntityRailProps<T extends ResourceEntityRailItem, TActionContext = unknown> = {
  addIcon?: ReactNode
  addLabel: string
  ariaLabel: string
  /** Header for the non-pinned group ("助手" for assistants, "智能体" for agents). */
  defaultGroupLabel?: string
  emptyFallback?: ReactNode
  getContextMenuActions?: (item: T) => readonly ResolvedAction<TActionContext>[]
  listRef?: RefObject<HTMLDivElement | null>
  onAdd: () => void | Promise<void>
  /** When provided, a history-records button sits next to the add button. */
  onOpenHistoryRecords?: () => void
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
  emptyFallback,
  getContextMenuActions,
  listRef,
  onAdd,
  onOpenHistoryRecords,
  onContextMenuAction,
  onReorder,
  onSelect,
  selectedId,
  status = 'idle',
  variant,
  items
}: ResourceEntityRailProps<T, TActionContext>) {
  const { t } = useTranslation()
  const fallbackListRef = useRef<HTMLDivElement>(null)
  const effectiveListRef = listRef ?? fallbackListRef
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
  // Collapsible sections matching the efficiency view's left assistant/agent layout (minus the nested
  // topics/sessions): pinned entities float into "已固定" at the top, the rest sit under the
  // "助手" / "智能体" section below. Section headers stay flush-left; the entity rows keep their
  // avatar and read as indented beneath. The single-section case (nothing pinned) renders the flat
  // list with no header, exactly like the efficiency view.
  const sectionBy = useMemo<(item: T) => ResourceListSection>(
    () => (item) =>
      item.pinned
        ? { id: ENTITY_RAIL_PINNED_SECTION_ID, label: t('selector.common.pinned_title') }
        : { id: ENTITY_RAIL_DEFAULT_SECTION_ID, label: defaultGroupLabel ?? '' },
    [defaultGroupLabel, t]
  )
  // Header-less groups (one per section, distinct ids) keep entity avatars visible and stop
  // drag-reorder from crossing the pinned/non-pinned boundary.
  const groupBy = useMemo<(item: T) => ResourceListGroup>(
    () => (item) => ({ id: item.pinned ? ENTITY_RAIL_PINNED_GROUP_ID : ENTITY_RAIL_DEFAULT_GROUP_ID, label: '' }),
    []
  )

  // Alias the compound provider to a local before rendering — same pattern as TopicList/SessionList.
  // Written inline as `<ResourceList.Provider>` it gets auto-rewritten to `<ResourceList>` by the
  // React-19 "drop Context .Provider" lint fixer (ResourceList.Provider only looks like a Context).
  const Provider = ResourceList.Provider

  return (
    <Provider
      variant={variant}
      items={items}
      selectedId={selectedId}
      status={status}
      groupBy={groupBy}
      sectionBy={sectionBy}
      defaultGroupVisibleCount={Number.POSITIVE_INFINITY}
      dragCapabilities={{
        groups: false,
        items: !!onReorder,
        itemSameGroup: !!onReorder,
        itemCrossGroup: false
      }}
      canDragItem={({ item }) => !!onReorder && !item.pinned}
      canDropItem={({ activeItem, targetGroupId }) =>
        !!onReorder && !activeItem.pinned && targetGroupId !== ENTITY_RAIL_PINNED_GROUP_ID
      }
      onReorder={onReorder}>
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
        </ResourceList.Header>
        <ResourceList.Body<T>
          listRef={effectiveListRef}
          draggable={!!onReorder}
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
