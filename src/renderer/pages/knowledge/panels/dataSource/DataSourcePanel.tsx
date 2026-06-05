import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem, KnowledgeItemType } from '@shared/data/types/knowledge'
import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from '../../components/addKnowledgeItemDialog/constants'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { usePreviewKnowledgeSource } from '../../hooks/usePreviewKnowledgeSource'
import DataSourcePanelHeader from './DataSourcePanelHeader'
import KnowledgeItemList from './KnowledgeItemList'
import { dataSourceTypeDisplayConfig } from './utils/models'
import { getItemTitle, getReadyCount } from './utils/selectors'

export interface DataSourcePanelProps {
  items: KnowledgeItem[]
  isLoading: boolean
  searchQuery?: string
  onAdd: (source?: KnowledgeItemType, files?: File[]) => void
  onItemClick?: (itemId: string) => void
  onDelete: (item: KnowledgeItem) => void | Promise<unknown>
  onReindex: (item: KnowledgeItem) => void | Promise<unknown>
}

const matchesSearch = (item: KnowledgeItem, query: string) => {
  if (!query) {
    return true
  }
  return getItemTitle(item).toLowerCase().includes(query.toLowerCase())
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
  isLoading,
  searchQuery = '',
  onAdd,
  onItemClick,
  onDelete,
  onReindex
}: DataSourcePanelProps) => {
  const { t } = useTranslation()
  const { previewSource } = usePreviewKnowledgeSource()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [pendingDeleteItem, setPendingDeleteItem] = useState<KnowledgeItem | null>(null)
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)

  const visibleItems = useMemo(() => items.filter((item) => matchesSearch(item, searchQuery)), [items, searchQuery])

  useEffect(() => {
    setSelectedIds((prev) => {
      const visibleItemIds = new Set(visibleItems.map((item) => item.id))
      const next = new Set([...prev].filter((itemId) => visibleItemIds.has(itemId)))

      return next.size === prev.size ? prev : next
    })
  }, [visibleItems])

  const readyCount = useMemo(() => getReadyCount(items), [items])

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
      setSelectedIds(next ? new Set(visibleItems.map((item) => item.id)) : new Set())
    },
    [visibleItems]
  )

  const handleCancelBulk = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleBulkReindex = useCallback(async () => {
    const targets = visibleItems.filter((item) => selectedIds.has(item.id))
    try {
      await Promise.all(targets.map((item) => onReindex(item)))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.reindex_failed')))
      return
    }
    setSelectedIds(new Set())
  }, [onReindex, selectedIds, t, visibleItems])

  const handleBulkDelete = useCallback(async () => {
    const targets = visibleItems.filter((item) => selectedIds.has(item.id))
    try {
      await Promise.all(targets.map((item) => onDelete(item)))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
      return
    }
    setSelectedIds(new Set())
    setIsBulkDeleteOpen(false)
  }, [onDelete, selectedIds, t, visibleItems])

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

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (files.length > 0) {
      onAdd('file', files)
    }
  }

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleAddSource = useCallback(
    (source?: KnowledgeItemType, files?: File[]) => {
      if (source === 'file' && !files?.length) {
        openFilePicker()
        return
      }

      if (files?.length) {
        onAdd(source, files)
        return
      }

      onAdd(source)
    },
    [onAdd, openFilePicker]
  )

  return (
    <KnowledgePanelShell
      headerClassName="shrink-0 px-3 pt-4"
      header={
        <div className="border-border-muted border-b pb-3">
          <DataSourcePanelHeader
            readyCount={readyCount}
            totalCount={items.length}
            selectedCount={selectedIds.size}
            onBulkReindex={handleBulkReindex}
            onBulkDelete={() => setIsBulkDeleteOpen(true)}
            onCancelBulk={handleCancelBulk}
            onAdd={handleAddSource}
          />
        </div>
      }>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileSelect}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {!isLoading && items.length === 0 ? (
          <DataSourceEmptyState onAddSource={handleAddSource} />
        ) : (
          <KnowledgeItemList
            items={visibleItems}
            allItemsCount={items.length}
            isLoading={isLoading}
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
