import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem, KnowledgeItemOf, KnowledgeItemType } from '@shared/data/types/knowledge'
import { ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from '../../components/addKnowledgeItemDialog/constants'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { usePreviewKnowledgeSource } from '../../hooks/usePreviewKnowledgeSource'
import DataSourcePanelHeader from './DataSourcePanelHeader'
import KnowledgeItemList from './KnowledgeItemList'
import { dataSourceTypeDisplayConfig } from './utils/models'
import { getItemTitle } from './utils/selectors'

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
  /** View a non-directory item's chunks in-app (note left-click + the row's context menu). */
  onItemClick?: (itemId: string) => void
  /** Drill into a directory item to list its children. */
  onDrillIntoDirectory?: (item: KnowledgeItemOf<'directory'>) => void
  /** The directory currently drilled into, or null/undefined at the base root. */
  currentDirectory?: KnowledgeItemOf<'directory'> | null
  /** Navigate one level up out of {@link currentDirectory}. */
  onNavigateUp?: () => void
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
  onDrillIntoDirectory,
  currentDirectory,
  onNavigateUp,
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

  // Left-click dispatch by item type: a directory drills in, a file/url opens with the system
  // tool (`previewSource` toasts its own errors), and a note falls back to the in-app chunk view.
  const handleActivateItem = useCallback(
    (item: KnowledgeItem) => {
      if (item.type === 'directory') {
        onDrillIntoDirectory?.(item)
        return
      }
      if (item.type === 'file' || item.type === 'url') {
        void previewSource(item)
        return
      }
      onItemClick?.(item.id)
    },
    [onDrillIntoDirectory, onItemClick, previewSource]
  )

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
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.reindex_failed')))
      return
    }
    setSelectedIds(new Set())
  }, [items, onReindex, selectedIds, t])

  const handleBulkDelete = useCallback(async () => {
    const targets = items.filter((item) => selectedIds.has(item.id))
    try {
      await Promise.all(targets.map((item) => onDelete(item)))
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
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
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
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
            canAddSource={!currentDirectory}
          />
        </div>
      }>
      <div className="flex min-h-0 flex-1 flex-col">
        {currentDirectory && onNavigateUp && (
          <div className="flex shrink-0 items-center gap-2 px-3 py-2">
            {/* Flat text button (no chrome): the `px-2.5` matches the row's own inset so the chevron
                lines up with the checkboxes, and it hints interactivity with an opacity shift
                instead of the ghost variant's hover background. */}
            <Button
              type="button"
              variant="ghost"
              onClick={onNavigateUp}
              className="h-auto min-h-0 gap-1 px-2.5 py-0 text-foreground text-sm opacity-70 shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-100">
              <ChevronLeft className="size-4" />
              {t('knowledge.data_source.back_to_parent')}
            </Button>
            <span className="min-w-0 truncate text-foreground-secondary text-sm" title={getItemTitle(currentDirectory)}>
              {getItemTitle(currentDirectory)}
            </span>
          </div>
        )}
        {!isLoading && items.length === 0 ? (
          currentDirectory ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12 text-center text-foreground-muted text-sm">
              {t('knowledge.data_source.empty_folder')}
            </div>
          ) : (
            <DataSourceEmptyState onAddSource={handleAddSource} />
          )
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
            onActivate={handleActivateItem}
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
