import { Checkbox } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { UIEvent } from 'react'
import { useCallback, useDeferredValue, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeItemRow from './KnowledgeItemRow'
import { knowledgeDataSourceCheckboxClassName, KNOWLEDGE_ITEM_ROW_GRID } from './styles'

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

  useEffect(() => {
    pendingLoadMoreRef.current = false
  }, [hasMore, items.length, isLoadingMore])

  const estimateItemSize = useCallback(() => ITEM_ESTIMATED_HEIGHT, [])

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

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3">
      <div className={cn(KNOWLEDGE_ITEM_ROW_GRID, 'h-10 shrink-0 border-border-muted border-b')}>
        <div className="flex items-center">
          <Checkbox
            size="sm"
            className={knowledgeDataSourceCheckboxClassName}
            aria-label={t('knowledge.data_source.table.select_all')}
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
          />
        </div>
        <div className="min-w-0 font-medium text-foreground-muted text-xs">
          {t('knowledge.data_source.table.columns.name')}
        </div>
        <div className="font-medium text-foreground-muted text-xs">{t('knowledge.data_source.table.columns.type')}</div>
        <div className="font-medium text-foreground-muted text-xs">
          {t('knowledge.data_source.table.columns.status')}
        </div>
        <div className="font-medium text-foreground-muted text-xs">
          {t('knowledge.data_source.table.columns.updated_at')}
        </div>
        <div />
      </div>
      <div className="min-h-0 flex-1">
        <DynamicVirtualList
          list={deferredItems}
          estimateSize={estimateItemSize}
          onScroll={handleListScroll}
          itemContainerStyle={{ paddingBottom: 6 }}
          className="pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {renderItemRow}
        </DynamicVirtualList>
      </div>
    </div>
  )
}

export default KnowledgeItemList
