import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import {
  ResourceList,
  type ResourceListReorderPayload,
  type ResourceListStatus
} from '@renderer/components/chat/resources'
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
  emptyFallback?: ReactNode
  getContextMenuActions?: (item: T) => readonly ResolvedAction<TActionContext>[]
  listRef?: RefObject<HTMLDivElement | null>
  onAdd: () => void | Promise<void>
  onContextMenuAction?: (item: T, action: ResolvedAction<TActionContext>) => void | Promise<void>
  onReorder?: (payload: ResourceListReorderPayload) => void | Promise<void>
  onSelect: (item: T) => void | Promise<void>
  selectedId?: string | null
  status?: ResourceListStatus
  variant: 'agent' | 'assistant'
  items: readonly T[]
}

export function ResourceEntityRail<T extends ResourceEntityRailItem, TActionContext = unknown>({
  addIcon,
  addLabel,
  ariaLabel,
  emptyFallback,
  getContextMenuActions,
  listRef,
  onAdd,
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
  const renderItem = useCallback(
    (item: T) => {
      const row = (
        <ResourceList.Item item={item} data-testid="resource-entity-rail-row" onClick={() => void onSelect(item)}>
          <ResourceList.ItemLeadingSlot>{item.icon}</ResourceList.ItemLeadingSlot>
          <ResourceList.ItemTitle title={item.name}>{item.name}</ResourceList.ItemTitle>
        </ResourceList.Item>
      )
      const actions = getContextMenuActions?.(item) ?? []
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
    [getContextMenuActions, onContextMenuAction, onSelect]
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
