import { ArrowDown, ArrowUp, ArrowUpDown, LoaderCircle } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback, useDeferredValue, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { KNOWLEDGE_ITEMS_PAGE_SIZE } from '@renderer/hooks/useKnowledgeItems'
import type { KnowledgeItemSort, KnowledgeItemSortBy } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import KnowledgeItemRow from './KnowledgeItemRow'
import { KNOWLEDGE_ITEM_ROW_GRID, knowledgeDataSourceCheckboxClassName } from './styles'

export interface KnowledgeItemListProps {
  sort?: KnowledgeItemSort | null
  onSortChange?: (sortBy: KnowledgeItemSortBy) => void
  items: KnowledgeItem[]
  isLoading: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  selectedIds: Set<string>
  onToggleOne: (itemId: string, next: boolean) => void
  onToggleAll: (next: boolean) => void
  /** Left-click / Enter on a row: open the source, drill into a directory, or view a note's chunks. */
  onActivate: (item: KnowledgeItem) => void
  onDelete: (item: KnowledgeItem) => void | Promise<unknown>
  onPreviewSource: (item: KnowledgeItem) => void | Promise<unknown>
  onReindex: (item: KnowledgeItem) => void | Promise<unknown>
  onViewChunks: (itemId: string) => void
}

const ITEM_ESTIMATED_HEIGHT = 44

const KnowledgeItemList = ({
  sort = null,
  onSortChange,
  items,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectedIds,
  onToggleOne,
  onToggleAll,
  onActivate,
  onDelete,
  onPreviewSource,
  onReindex,
  onViewChunks
}: KnowledgeItemListProps) => {
  const { t } = useTranslation()
  const pendingLoadMoreRef = useRef(false)
  const deferredItems = useDeferredValue(items)

  useEffect(() => {
    pendingLoadMoreRef.current = false
  }, [hasMore, items.length, isLoadingMore, sort])

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
        onClick={() => onActivate(item)}
        onDelete={() => onDelete(item)}
        onPreviewSource={() => onPreviewSource(item)}
        onReindex={() => onReindex(item)}
        onViewChunks={() => onViewChunks(item.id)}
      />
    ),
    [onActivate, onDelete, onPreviewSource, onReindex, onToggleOne, onViewChunks, selectedIds]
  )

  if (items.length === 0 && !isLoading) {
    return null
  }

  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id))
  const someSelected = !allSelected && items.some((item) => selectedIds.has(item.id))

  // ARIA grid semantics, lost in the table→CSS-grid migration. The virtualizer's scroller carries
  // role="rowgroup" (its wrapper is role="presentation" so the grid owns the rowgroup directly) and
  // the load-more/end footer lives outside the grid. The virtualizer still wraps each row in a
  // positioning div, so the rowgroup→row chain isn't strictly direct, but the row / columnheader /
  // gridcell roles still let assistive tech announce the columns and selection.
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3">
      <div
        role="grid"
        aria-label={t('knowledge.data_source.table.aria_label')}
        className="flex min-h-0 flex-1 flex-col">
        <div role="row" className={cn(KNOWLEDGE_ITEM_ROW_GRID, 'mb-2 h-11 shrink-0 border-b border-border px-2.5')}>
          <div role="columnheader" className="flex items-center self-stretch">
            {/* Full-cell label so the whole select-all column is clickable, matching the rows. */}
            <label className="flex size-full cursor-pointer items-center">
              <Checkbox
                size="sm"
                className={knowledgeDataSourceCheckboxClassName}
                aria-label={t('knowledge.data_source.table.select_all')}
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
              />
            </label>
          </div>
          {(
            [
              ['name', t('knowledge.data_source.table.columns.name')],
              ['type', t('knowledge.data_source.table.columns.type')],
              ['status', t('knowledge.data_source.table.columns.status')],
              ['updatedAt', t('knowledge.data_source.table.columns.updated_at')]
            ] as const
          ).map(([column, label]) => {
            const active = sort?.sortBy === column
            const Icon = active ? (sort.sortOrder === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
            return (
              <div
                key={column}
                role="columnheader"
                aria-sort={active ? (sort.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="min-w-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSortChange?.(column)}
                  className="h-8 min-h-0 max-w-full gap-1 px-0 text-xs font-medium text-foreground-tertiary hover:bg-transparent hover:text-foreground"
                  title={t('knowledge.data_source.table.sort_hint')}>
                  <span className="truncate">{label}</span>
                  <Icon aria-hidden="true" className="size-3 shrink-0" />
                </Button>
              </div>
            )
          })}
          {/* Actions column: header stays visually empty (the row's "more" button only shows on
              hover), but carries an aria-label so the trailing gridcell has a matching header. */}
          <div role="columnheader" aria-label={t('knowledge.data_source.table.columns.actions')} />
        </div>
        <div role="presentation" className="min-h-0 flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground-tertiary">
              {t('common.loading')}
            </div>
          ) : (
            <DynamicVirtualList
              key={`${sort?.sortBy ?? 'default'}:${sort?.sortOrder ?? ''}`}
              list={deferredItems}
              getItemKey={getItemKey}
              estimateSize={estimateItemSize}
              onScroll={handleListScroll}
              role="rowgroup"
              autoHideScrollbar
              itemContainerStyle={{ paddingBottom: 6 }}
              className="pb-6">
              {renderItemRow}
            </DynamicVirtualList>
          )}
        </div>
      </div>
      {isLoadingMore ? (
        <div
          className="flex h-8 shrink-0 items-center justify-center gap-1.5 text-xs text-foreground-tertiary"
          aria-live="polite">
          <LoaderCircle className="size-3.5 animate-spin" />
          {t('knowledge.data_source.list.loading_more')}
        </div>
      ) : !hasMore && items.length > KNOWLEDGE_ITEMS_PAGE_SIZE ? (
        // End-of-list only after a real second page loaded (>1 page worth of rows). Deriving this
        // from the live count instead of a sticky ref means it can't leak across base switches.
        <div className="flex h-8 shrink-0 items-center justify-center text-xs text-foreground-tertiary">
          {t('knowledge.data_source.list.end_reached')}
        </div>
      ) : null}
    </div>
  )
}

export default KnowledgeItemList
