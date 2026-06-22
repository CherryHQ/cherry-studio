import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem, KnowledgeItemType } from '@shared/data/types/knowledge'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from '../../components/addKnowledgeItemDialog/constants'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { usePreviewKnowledgeSource } from '../../hooks/usePreviewKnowledgeSource'
import DataSourcePanelHeader from './DataSourcePanelHeader'
import KnowledgeItemList from './KnowledgeItemList'
import { dataSourceTypeDisplayConfig } from './utils/models'

export interface DataSourcePanelProps {
  items: KnowledgeItem[]
  /** Server-side total across all pages. Defaults to the loaded count when omitted. */
  total?: number
  isLoading: boolean
  /** Cursor-pagination controls; default to a fully-loaded list when omitted. */
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  updatedAt: string
  onAdd: (source?: KnowledgeItemType, files?: File[]) => void
  onItemClick?: (itemId: string) => void
  onDelete: (item: KnowledgeItem) => void | Promise<unknown>
  onReindex: (item: KnowledgeItem) => void | Promise<unknown>
}

const DataSourceEmptyState = ({ onAddSource }: { onAddSource: (source: KnowledgeItemType) => void }) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12 text-center">
      <div className="flex max-w-4xl flex-col items-center">
        <h3 className="font-semibold text-foreground text-lg leading-7">
          {t('knowledge.data_source.empty_description')}
        </h3>
        <p className="mt-2 text-foreground-muted text-sm leading-5">{t('knowledge.data_source.empty.title')}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => {
            const Icon = dataSourceTypeDisplayConfig[source.value].icon.icon

            return (
              <Button
                key={source.value}
                type="button"
                variant="outline"
                size="lg"
                className="h-9 w-24 rounded-lg px-3 font-medium"
                onClick={() => onAddSource(source.value)}>
                <Icon className="size-4 text-foreground-secondary" />
                {t(source.labelKey)}
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const DataSourcePanel = ({
  items,
  total = items.length,
  isLoading,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore = () => undefined,
  updatedAt,
  onAdd,
  onItemClick,
  onDelete,
  onReindex
}: DataSourcePanelProps) => {
  const { t } = useTranslation()
  const { previewSource } = usePreviewKnowledgeSource()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [pendingDeleteItem, setPendingDeleteItem] = useState<KnowledgeItem | null>(null)
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)

  useEffect(() => {
    setSelectedIds((prev) => {
      const itemIds = new Set(items.map((item) => item.id))
      const next = new Set([...prev].filter((itemId) => itemIds.has(itemId)))

      return next.size === prev.size ? prev : next
    })
  }, [items])

  const handleItemClick = (itemId: string) => onItemClick?.(itemId)

  const handleToggleOne = useCallback((itemId: string, next: boolean) => {
    setSelectedIds((prev) => {
      const updated = new Set(prev)
      if (next) {
        updated.add(itemId)
      } else {
        updated.delete(itemId)
      }
      return updated
    })
  }, [])

  const handleToggleAll = useCallback(
    (next: boolean) => {
      setSelectedIds(next ? new Set(items.map((item) => item.id)) : new Set())
    },
    [items]
  )

  const handleBulkReindex = useCallback(async () => {
    const targets = items.filter((item) => selectedIds.has(item.id))
    try {
      await Promise.all(targets.map((item) => onReindex(item)))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.reindex_failed')))
      return
    }
    setSelectedIds(new Set())
  }, [items, onReindex, selectedIds, t])

  const handleBulkDelete = useCallback(async () => {
    const targets = items.filter((item) => selectedIds.has(item.id))
    try {
      await Promise.all(targets.map((item) => onDelete(item)))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
      return
    }
    setSelectedIds(new Set())
    setIsBulkDeleteOpen(false)
  }, [items, onDelete, selectedIds, t])

  const handleConfirmDelete = async () => {
    if (!pendingDeleteItem) {
      return
    }

    try {
      await onDelete(pendingDeleteItem)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
      return
    }

    setPendingDeleteItem(null)
  }

  const handleAddSource = useCallback((source: KnowledgeItemType) => onAdd(source), [onAdd])

  return (
    <KnowledgePanelShell
      headerClassName="shrink-0 px-3 pt-1"
      header={
        <div className="border-border-muted border-b pb-3">
          <DataSourcePanelHeader
            total={total}
            loadedCount={items.length}
            selectedCount={selectedIds.size}
            updatedAt={updatedAt}
            onBulkReindex={handleBulkReindex}
            onBulkDelete={() => setIsBulkDeleteOpen(true)}
            onAdd={handleAddSource}
          />
        </div>
      }>
      <div className="flex min-h-0 flex-1 flex-col">
        {!isLoading && items.length === 0 ? (
          <DataSourceEmptyState onAddSource={handleAddSource} />
        ) : (
          <KnowledgeItemList
            items={items}
            isLoading={isLoading}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={onLoadMore}
            selectedIds={selectedIds}
            onToggleOne={handleToggleOne}
            onToggleAll={handleToggleAll}
            onItemClick={handleItemClick}
            onDelete={setPendingDeleteItem}
            onPreviewSource={previewSource}
            onReindex={onReindex}
            onViewChunks={handleItemClick}
          />
        )}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteItem)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteItem(null)
          }
        }}
        title={t('knowledge.data_source.delete_confirm_title')}
        description={t('knowledge.data_source.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleConfirmDelete}
      />
      <ConfirmDialog
        open={isBulkDeleteOpen}
        onOpenChange={setIsBulkDeleteOpen}
        title={t('knowledge.data_source.bulk.delete_confirm_title')}
        description={t('knowledge.data_source.bulk.delete_confirm_description', { count: selectedIds.size })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleBulkDelete}
      />
    </KnowledgePanelShell>
  )
}

export default DataSourcePanel
