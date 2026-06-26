import { Tooltip } from '@cherrystudio/ui'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import {
  ResourceList,
  type ResourceListReorderPayload,
  type ResourceListStatus
} from '@renderer/components/chat/resources'
import { CommandPopupMenu } from '@renderer/components/command'
import { cn } from '@renderer/utils/style'
import { MoreHorizontal, SquarePen } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export type ResourceEntityRailItem = {
  id: string
  name: string
  icon: ReactNode
  orderKey?: string
}

export type ResourceEntityRailProps<T extends ResourceEntityRailItem, TActionContext = unknown> = {
  addIcon?: ReactNode
  addLabel: string
  ariaLabel: string
  createItemLabel?: string
  emptyFallback?: ReactNode
  getContextMenuActions?: (item: T) => readonly ResolvedAction<TActionContext>[]
  listRef?: RefObject<HTMLDivElement | null>
  onAdd: () => void | Promise<void>
  onContextMenuAction?: (item: T, action: ResolvedAction<TActionContext>) => void | Promise<void>
  onCreateItem?: (item: T) => void | Promise<void>
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
  createItemLabel,
  emptyFallback,
  getContextMenuActions,
  listRef,
  onAdd,
  onContextMenuAction,
  onCreateItem,
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
      const trailingActionCount = (onCreateItem && createItemLabel ? 1 : 0) + (hasVisibleMenuActions ? 1 : 0)
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
          {(onCreateItem || hasVisibleMenuActions) && (
            <ResourceList.ItemActions>
              {onCreateItem && createItemLabel && (
                <Tooltip title={createItemLabel} delay={500}>
                  <ResourceList.GroupHeaderActionButton
                    type="button"
                    aria-label={createItemLabel}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onCreateItem(item)
                    }}>
                    <SquarePen className="block" />
                  </ResourceList.GroupHeaderActionButton>
                </Tooltip>
              )}
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
    [createItemLabel, getContextMenuActions, onContextMenuAction, onCreateItem, onSelect, runContextMenuAction, t]
  )
  const empty = useMemo(() => emptyFallback ?? <div className="min-h-0 flex-1" />, [emptyFallback])

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
      dragCapabilities={{
        groups: false,
        items: !!onReorder,
        itemSameGroup: !!onReorder,
        itemCrossGroup: false
      }}
      canDragItem={() => !!onReorder}
      canDropItem={() => !!onReorder}
      onReorder={onReorder}>
      <ResourceList.Frame className="h-full min-h-0" data-testid={`${variant}-entity-rail`}>
        <ResourceList.Header className="gap-1">
          <ResourceList.HeaderItem
            type="button"
            icon={addIcon}
            label={addLabel}
            aria-label={addLabel}
            onClick={() => void onAdd()}
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
