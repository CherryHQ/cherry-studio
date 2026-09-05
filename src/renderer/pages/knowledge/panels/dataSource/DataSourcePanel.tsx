import { Button, CircularProgress, ConfirmDialog } from '@cherrystudio/ui'
import { useDrag } from '@renderer/hooks/useDrag'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY, type LocalModelStatus } from '@shared/data/presets/localModel'
import type { KnowledgeItem, KnowledgeItemOf, KnowledgeItemType } from '@shared/data/types/knowledge'
import type { TFunction } from 'i18next'
import { ChevronLeft, Settings2 } from 'lucide-react'
import { type DragEvent, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from '../../components/addKnowledgeItemDialog/constants'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { usePreviewKnowledgeSource } from '../../hooks/usePreviewKnowledgeSource'
import type { KnowledgeFilePreviewTarget } from '../../types'
import DataSourcePanelHeader from './DataSourcePanelHeader'
import KnowledgeItemList from './KnowledgeItemList'
import { dataSourceTypeDisplayConfig } from './utils/models'
import { canReindexKnowledgeItem, getItemTitle } from './utils/selectors'

export interface DataSourcePanelProps {
  embeddingModelId?: string | null
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
  onPreviewFile: (target: KnowledgeFilePreviewTarget) => void
  /** View an item's indexed chunks in-app (the row's context menu). */
  onItemClick?: (itemId: string) => void
  /** View a note's original stored content in-app (note left-click). */
  onViewNoteContent?: (itemId: string) => void
  /** Drill into a directory item to list its children. */
  onDrillIntoDirectory?: (item: KnowledgeItemOf<'directory'>) => void
  /** The directory currently drilled into, or null/undefined at the base root. */
  currentDirectory?: KnowledgeItemOf<'directory'> | null
  /** Navigate one level up out of {@link currentDirectory}. */
  onNavigateUp?: () => void
  onDelete: (item: KnowledgeItem) => void | Promise<unknown>
  onDeleteItems: (itemIds: string[]) => void | Promise<unknown>
  onReindex: (item: KnowledgeItem) => void | Promise<unknown>
  onReindexItems: (itemIds: string[]) => void | Promise<unknown>
}

type LocalEmbeddingStatus = Exclude<LocalModelStatus, 'ready'>

interface LocalEmbeddingState {
  status: LocalEmbeddingStatus
  percent: number
}

const openLocalModelSettings = () => openSettingsTab('/settings/local-models')

const getLocalEmbeddingStatusLabel = (status: LocalEmbeddingStatus, t: TFunction) => {
  switch (status) {
    case 'error':
      return t('knowledge.rag.download_local_embedding_failed')
    case 'unsupported':
      return t('settings.dependencies.localModels.unsupported')
    case 'not_downloaded':
      return t('knowledge.rag.download_local_model')
    case 'downloading':
      return t('settings.dependencies.localModels.status.downloading')
  }
}

const LocalEmbeddingStatus = ({ status, percent }: LocalEmbeddingState) => {
  const { t } = useTranslation()
  const downloading = status === 'downloading'
  const canOpenSettings = status === 'not_downloaded' || status === 'error'

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div role="status" aria-live="polite" className="flex flex-col items-center">
        {downloading ? (
          <CircularProgress
            value={Math.floor(percent)}
            size={80}
            strokeWidth={6}
            showLabel
            labelClassName="font-medium text-foreground text-sm tabular-nums"
            renderLabel={(progress) => `${progress}%`}
          />
        ) : null}
        <h3
          className={
            downloading
              ? 'mt-5 font-semibold text-base text-foreground leading-6'
              : 'font-semibold text-base text-foreground leading-6'
          }>
          {t('settings.dependencies.localModels.embedding.name')}
        </h3>
        <p className="mt-1 text-foreground-tertiary text-sm leading-5">{getLocalEmbeddingStatusLabel(status, t)}</p>
      </div>
      {canOpenSettings ? (
        <Button type="button" variant="outline" size="sm" className="mt-5" onClick={openLocalModelSettings}>
          <Settings2 className="size-3.5" />
          {t('common.go_to_settings')}
        </Button>
      ) : null}
    </div>
  )
}

const DataSourceEmptyState = ({ onAddSource }: { onAddSource: (source: KnowledgeItemType) => void }) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12 text-center">
      <div className="flex max-w-4xl flex-col items-center">
        <h3 className="font-semibold text-foreground text-lg leading-7">
          {t('knowledge.data_source.empty_description')}
        </h3>
        <p className="mt-2 text-foreground-tertiary text-sm leading-5">{t('knowledge.data_source.empty.title')}</p>
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
                <Icon className="size-4 text-muted-foreground" />
                {t(source.labelKey)}
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface DataSourcePanelContentProps extends DataSourcePanelProps {
  localEmbeddingState?: LocalEmbeddingState
}

const DataSourcePanelContent = ({
  items,
  total = items.length,
  isLoading,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore = () => undefined,
  updatedAt,
  onAdd,
  onPreviewFile,
  onItemClick,
  onViewNoteContent,
  onDrillIntoDirectory,
  currentDirectory,
  onNavigateUp,
  onDelete,
  onDeleteItems,
  onReindex,
  onReindexItems,
  localEmbeddingState
}: DataSourcePanelContentProps) => {
  const { t } = useTranslation()
  const { invalidatePreviewRequests, previewSource } = usePreviewKnowledgeSource(
    onPreviewFile,
    currentDirectory?.id ?? null
  )
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

  // A directory drills in; files and captured URLs preview inline; uncaptured valid HTTP URLs open
  // in the system browser; notes show their original stored content. `previewSource` owns warnings
  // and error toasts. Chunks are a separate advanced action reached from the row's context menu.
  const handleActivateItem = useCallback(
    (item: KnowledgeItem) => {
      if (item.type === 'directory') {
        invalidatePreviewRequests()
        onDrillIntoDirectory?.(item)
        return
      }
      if (item.type === 'file' || item.type === 'url') {
        void previewSource(item)
        return
      }
      onViewNoteContent?.(item.id)
    },
    [invalidatePreviewRequests, onDrillIntoDirectory, onViewNoteContent, previewSource]
  )

  const handleNavigateUp = useCallback(() => {
    invalidatePreviewRequests()
    onNavigateUp?.()
  }, [invalidatePreviewRequests, onNavigateUp])

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
    const selectedItems = items.filter((item) => selectedIds.has(item.id))
    // The main process rejects the whole batch when any selected item is still
    // indexing, which would also drop the failed ones the user wants to retry.
    // Skip them here instead, mirroring the row menu's own gate.
    const reindexableItems = selectedItems.filter(canReindexKnowledgeItem)
    const skippedCount = selectedItems.length - reindexableItems.length

    if (reindexableItems.length === 0) {
      toast.warning(t('knowledge.data_source.bulk.reindex_none_eligible'))
      return
    }

    try {
      await onReindexItems(reindexableItems.map((item) => item.id))
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.reindex_failed')))
      return
    }
    if (skippedCount > 0) {
      toast.warning(t('knowledge.data_source.bulk.reindex_skipped', { count: skippedCount }))
    }
    setSelectedIds(new Set())
  }, [items, onReindexItems, selectedIds, t])

  const handleBulkDelete = useCallback(async () => {
    const itemIds = items.filter((item) => selectedIds.has(item.id)).map((item) => item.id)
    try {
      await onDeleteItems(itemIds)
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
      return
    }
    setSelectedIds(new Set())
    setIsBulkDeleteOpen(false)
  }, [items, onDeleteItems, selectedIds, t])

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
  const handleFileDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) {
        onAdd('file', files)
      }
    },
    [onAdd]
  )
  const { isDragging, handleDragEnter, handleDragLeave, handleDragOver, handleDrop } =
    useDrag<HTMLDivElement>(handleFileDrop)
  const canAddSource = !currentDirectory && !localEmbeddingState
  const localModelStatus =
    localEmbeddingState && (items.length > 0 || Boolean(currentDirectory))
      ? {
          label:
            localEmbeddingState.status === 'downloading'
              ? `${getLocalEmbeddingStatusLabel(localEmbeddingState.status, t)} ${Math.floor(localEmbeddingState.percent)}%`
              : getLocalEmbeddingStatusLabel(localEmbeddingState.status, t),
          onOpenSettings: localEmbeddingState.status === 'unsupported' ? undefined : openLocalModelSettings
        }
      : undefined

  return (
    <KnowledgePanelShell
      headerClassName="shrink-0 px-3"
      header={
        <div className="flex h-11 items-center border-border border-b">
          <DataSourcePanelHeader
            total={total}
            loadedCount={items.length}
            selectedCount={selectedIds.size}
            updatedAt={updatedAt}
            onBulkReindex={handleBulkReindex}
            onBulkDelete={() => setIsBulkDeleteOpen(true)}
            onAdd={handleAddSource}
            canAddSource={canAddSource}
            localModelStatus={localModelStatus}
          />
        </div>
      }>
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onDragEnter={canAddSource ? handleDragEnter : undefined}
        onDragLeave={canAddSource ? handleDragLeave : undefined}
        onDragOver={canAddSource ? handleDragOver : undefined}
        onDrop={canAddSource ? handleDrop : undefined}>
        {isDragging && canAddSource ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-lg border border-primary border-dashed bg-background/90 text-foreground shadow-sm">
            <span className="font-medium text-sm">{t('files.drag_upload')}</span>
          </div>
        ) : null}
        {currentDirectory && onNavigateUp && (
          <div className="flex shrink-0 items-center gap-2 px-3 py-2">
            {/* Flat text button (no chrome): the `px-2.5` matches the row's own inset so the chevron
                lines up with the checkboxes, and it hints interactivity with an opacity shift
                instead of the ghost variant's hover background. */}
            <Button
              type="button"
              variant="ghost"
              onClick={handleNavigateUp}
              className="h-auto min-h-0 gap-1 px-2.5 py-0 text-foreground text-sm opacity-70 shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-100">
              <ChevronLeft className="size-4" />
              {t('knowledge.data_source.back_to_parent')}
            </Button>
            <span className="min-w-0 truncate text-muted-foreground text-sm" title={getItemTitle(currentDirectory)}>
              {getItemTitle(currentDirectory)}
            </span>
          </div>
        )}
        {localEmbeddingState && items.length === 0 && !currentDirectory ? (
          <LocalEmbeddingStatus {...localEmbeddingState} />
        ) : !isLoading && items.length === 0 ? (
          currentDirectory ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12 text-center text-foreground-tertiary text-sm">
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

const LocalEmbeddingDataSourcePanel = (props: DataSourcePanelProps) => {
  const { status, percent } = useLocalModel(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.embedding)

  return (
    <DataSourcePanelContent {...props} localEmbeddingState={status === 'ready' ? undefined : { status, percent }} />
  )
}

const DataSourcePanel = (props: DataSourcePanelProps) =>
  props.embeddingModelId === LOCAL_EMBEDDING_UNIQUE_MODEL_ID ? (
    <LocalEmbeddingDataSourcePanel {...props} />
  ) : (
    <DataSourcePanelContent {...props} />
  )

export default DataSourcePanel
