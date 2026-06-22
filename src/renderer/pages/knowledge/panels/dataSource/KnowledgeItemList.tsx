import { Checkbox } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { LoaderCircle } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback, useDeferredValue, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeItemRow from './KnowledgeItemRow'
import { KNOWLEDGE_ITEM_ROW_GRID, knowledgeDataSourceCheckboxClassName } from './styles'

export interface KnowledgeItemListProps {
  items: KnowledgeItem[]
  isLoading: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  selectedIds: Set<string>
  onToggleOne: (itemId: string, next: boolean) => void
  onToggleAll: (next: boolean) => void
  onItemClick: (itemId: string) => void
  onDelete: (item: KnowledgeItem) => void | Promise<unknown>
  onPreviewSource: (item: KnowledgeItem) => void | Promise<unknown>
  onReindex: (item: KnowledgeItem) => void | Promise<unknown>
  onViewChunks: (itemId: string) => void
}

const ITEM_ESTIMATED_HEIGHT = 52

const KnowledgeItemList = ({
  items,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectedIds,
  onToggleOne,
  onToggleAll,
  onItemClick,
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: KnowledgeItemListProps) => {
  const { t } = useTranslation()
  const pendingLoadMoreRef = useRef(false)
  const deferredItems = useDeferredValue(items)
  // Only show the "no more items" footer once the user has actually paginated, so a small
  // single-page base never renders an end-of-list line.
  const hasPaginatedRef = useRef(false)

  useEffect(() => {
    pendingLoadMoreRef.current = false
  }, [hasMore, items.length, isLoadingMore])

  useEffect(() => {
    if (isLoadingMore) {
      hasPaginatedRef.current = true
    }
  }, [isLoadingMore])

  const estimateItemSize = useCallback(() => ITEM_ESTIMATED_HEIGHT, [])

  // Stable, identity-based key instead of the virtualizer's default index: polling inserts a
  // newly-added item at the top, and an index key would reconcile the wrong row's local state
  // (open menu, checkbox) into a reused instance and mis-key @tanstack's per-index measurement
  // cache. Fall back to the index only for an out-of-range lookup during the deferred-value lag.
  const getItemKey = useCallback((index: number) => deferredItems[index]?.id ?? index, [deferredItems])

  const handleListScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (
        hasMore &&
        !isLoadingMore &&
        !pendingLoadMoreRef.current &&
        el.scrollHeight - el.scrollTop - el.clientHeight < ITEM_ESTIMATED_HEIGHT * 4
      ) {
        pendingLoadMoreRef.current = true
        queueMicrotask(onLoadMore)
      }
    },
    [hasMore, isLoadingMore, onLoadMore]
  )

  const renderItemRow = useCallback(
    (item: KnowledgeItem) => (
      <KnowledgeItemRow
        item={item}
        selected={selectedIds.has(item.id)}
        onToggleSelect={(next) => onToggleOne(item.id, next)}
        onClick={() => onItemClick(item.id)}
        onDelete={() => onDelete(item)}
        onPreviewSource={() => onPreviewSource(item)}
        onReindex={() => onReindex(item)}
        onViewChunks={() => onViewChunks(item.id)}
      />
    ),
    [onDelete, onItemClick, onPreviewSource, onReindex, onToggleOne, onViewChunks, selectedIds]
  )

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-foreground-muted text-sm">
        {t('common.loading')}
      </div>
    )
  }

  if (items.length === 0) {
    return null
  }

  const allSelected = items.every((item) => selectedIds.has(item.id))
  const someSelected = !allSelected && items.some((item) => selectedIds.has(item.id))

  // ARIA grid semantics, lost in the table→CSS-grid migration. The virtualizer wraps each row in
  // its own positioning div, so the grid→row chain isn't strictly direct, but the row / column-
  // header / gridcell roles still let assistive tech announce the columns and selection.
  return (
    <div
      role="grid"
      aria-label={t('knowledge.data_source.table.aria_label')}
      className="flex min-h-0 flex-1 flex-col px-3">
      <div role="row" className={cn(KNOWLEDGE_ITEM_ROW_GRID, 'h-10 shrink-0 border-border-muted border-b')}>
        <div role="columnheader" className="flex items-center">
          <Checkbox
            size="sm"
            className={knowledgeDataSourceCheckboxClassName}
            aria-label={t('knowledge.data_source.table.select_all')}
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
          />
        </div>
        <div role="columnheader" className="min-w-0 font-medium text-foreground-muted text-xs">
          {t('knowledge.data_source.table.columns.name')}
        </div>
        <div role="columnheader" className="font-medium text-foreground-muted text-xs">
          {t('knowledge.data_source.table.columns.type')}
        </div>
        <div role="columnheader" className="font-medium text-foreground-muted text-xs">
          {t('knowledge.data_source.table.columns.status')}
        </div>
        <div role="columnheader" className="font-medium text-foreground-muted text-xs">
          {t('knowledge.data_source.table.columns.updated_at')}
        </div>
        <div role="columnheader" aria-label={t('knowledge.data_source.table.columns.actions')} />
      </div>
      <div className="min-h-0 flex-1">
        <DynamicVirtualList
          list={deferredItems}
          getItemKey={getItemKey}
          estimateSize={estimateItemSize}
          onScroll={handleListScroll}
          autoHideScrollbar
          itemContainerStyle={{ paddingBottom: 6 }}
          className="pb-6">
          {renderItemRow}
        </DynamicVirtualList>
      </div>
      {isLoadingMore ? (
        <div
          className="flex h-8 shrink-0 items-center justify-center gap-1.5 text-foreground-muted text-xs"
          aria-live="polite">
          <LoaderCircle className="size-3.5 animate-spin" />
          {t('knowledge.data_source.list.loading_more')}
        </div>
      ) : hasPaginatedRef.current && !hasMore ? (
        <div className="flex h-8 shrink-0 items-center justify-center text-foreground-muted text-xs">
          {t('knowledge.data_source.list.end_reached')}
        </div>
      ) : null}
    </div>
  )
}

export default KnowledgeItemList
