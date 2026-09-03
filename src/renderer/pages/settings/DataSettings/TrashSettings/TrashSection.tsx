import { Button, Checkbox } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { Loader } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TrashItemRow from './TrashItemRow'
import type { TrashBatchOutcome, TrashItem } from './trashUtils'

const logger = loggerService.withContext('TrashSection')

export interface PendingPermanentDelete {
  items: TrashItem[]
  run: (items: TrashItem[]) => Promise<TrashBatchOutcome>
  fileEntryIds?: string[]
}

export type TrashSectionPagination =
  | { kind: 'cursor'; hasMore: boolean; isLoadingMore: boolean; onLoadMore: () => void }
  | {
      kind: 'offset'
      page: number
      totalPages: number
      totalCount: number
      hasPrev: boolean
      hasNext: boolean
      onPrevPage: () => void
      onNextPage: () => void
    }

interface TrashSectionProps {
  items: TrashItem[]
  isLoading: boolean
  error: Error | undefined
  onRetry: () => void
  pagination?: TrashSectionPagination
  isBatchMode: boolean
  retentionDays: number
  pendingRestoreId: string | null
  isPermanentDeleting: boolean
  onRestore: (item: TrashItem) => void
  onRestoreMany: (items: TrashItem[]) => Promise<TrashBatchOutcome>
  onPermanentDelete: (item: TrashItem) => Promise<TrashBatchOutcome>
  onPermanentDeleteMany: (items: TrashItem[]) => Promise<TrashBatchOutcome>
  onRequestDelete: (request: PendingPermanentDelete) => void
  includeFileReferencePreview?: boolean
}

const TrashSection: FC<TrashSectionProps> = ({
  items,
  isLoading,
  error,
  onRetry,
  pagination,
  isBatchMode,
  retentionDays,
  pendingRestoreId,
  isPermanentDeleting,
  onRestore,
  onRestoreMany,
  onPermanentDelete,
  onPermanentDeleteMany,
  onRequestDelete,
  includeFileReferencePreview = false
}) => {
  const { t } = useTranslation()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [isBatchActionPending, setIsBatchActionPending] = useState(false)
  const mountedRef = useRef(true)
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items])
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds])
  const isSectionBusy = pendingRestoreId !== null || isBatchActionPending || isPermanentDeleting

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    []
  )

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => itemIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [itemIds])

  useEffect(() => {
    if (!isBatchMode) setSelectedIds(new Set())
  }, [isBatchMode])

  const applyOutcome = (outcome: TrashBatchOutcome) => {
    if (!mountedRef.current || outcome.succeeded.length === 0) return
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of outcome.succeeded) next.delete(id)
      return next
    })
  }

  const showBatchOutcome = (action: 'restore' | 'permanent_delete', outcome: TrashBatchOutcome) => {
    const succeeded = outcome.succeeded.length
    const stale = outcome.failed.filter(({ reason }) => reason === 'no-longer-in-recycle-bin').length
    const failed = outcome.failed.length - stale
    if (action === 'permanent_delete' && stale > 0) {
      toast.warning(
        t('settings.data.trash.permanent_delete.batch_stale_summary', {
          succeeded,
          stale,
          failed
        })
      )
      return
    }
    const key =
      outcome.failed.length === 0
        ? `settings.data.trash.${action}.batch_success`
        : `settings.data.trash.${action}.batch_partial`
    toast[outcome.failed.length === 0 ? 'success' : 'warning'](t(key, { count: succeeded, succeeded, failed }))
  }

  const handleRestoreSelected = async () => {
    const targets = selectedItems
    if (targets.length === 0) return
    setIsBatchActionPending(true)
    try {
      const outcome = await onRestoreMany(targets)
      applyOutcome(outcome)
      showBatchOutcome('restore', outcome)
    } catch (error) {
      logger.error('batch restore failed', error as Error)
      toast.error(t('settings.data.trash.restore.error'))
    } finally {
      if (mountedRef.current) setIsBatchActionPending(false)
    }
  }

  const requestPermanentDelete = (targets: TrashItem[], isBatch: boolean) => {
    if (targets.length === 0) return
    onRequestDelete({
      items: targets,
      fileEntryIds: includeFileReferencePreview ? targets.map((item) => item.id) : undefined,
      run: async (confirmedItems) => {
        if (mountedRef.current) setIsBatchActionPending(true)
        try {
          const outcome = isBatch
            ? await onPermanentDeleteMany(confirmedItems)
            : await onPermanentDelete(confirmedItems[0])
          applyOutcome(outcome)
          if (isBatch) showBatchOutcome('permanent_delete', outcome)
          return outcome
        } finally {
          if (mountedRef.current) setIsBatchActionPending(false)
        }
      }
    })
  }

  // Show offset prev/next whenever more than one page exists OR the user has
  // been stranded on a now-empty page past the first (so Prev remains reachable).
  const showOffsetControls = pagination?.kind === 'offset' && (pagination.totalPages > 1 || pagination.page > 1)

  return (
    <>
      {isBatchMode && (
        <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2 border-border border-b pb-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={
                selectedItems.length === 0 ? false : selectedItems.length === items.length ? true : 'indeterminate'
              }
              disabled={items.length === 0 || isLoading || Boolean(error) || isSectionBusy}
              aria-label={t('settings.data.trash.selection.select_all_visible')}
              onCheckedChange={(checked) => setSelectedIds(checked === true ? new Set(itemIds) : new Set())}
            />
            {!isLoading && !error && selectedItems.length > 0 && (
              <span className="text-muted-foreground text-sm">
                {t('settings.data.trash.selection.count', { count: selectedItems.length })}
              </span>
            )}
          </div>
          {!isLoading && !error && selectedItems.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={isSectionBusy} onClick={handleRestoreSelected}>
                {t('settings.data.trash.restore.selected', { count: selectedItems.length })}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isSectionBusy}
                onClick={() => requestPermanentDelete(selectedItems, true)}>
                {t('settings.data.trash.permanent_delete.selected', { count: selectedItems.length })}
              </Button>
              <Button variant="ghost" size="sm" disabled={isSectionBusy} onClick={() => setSelectedIds(new Set())}>
                {t('settings.data.trash.selection.clear')}
              </Button>
            </div>
          )}
        </div>
      )}
      {isLoading ? (
        <div className="flex min-h-16 items-center justify-center">
          <Loader size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2">
          <span className="text-destructive text-sm">{t('settings.data.trash.error.load')}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <div className="text-muted-foreground text-sm">{t('settings.data.trash.empty.section')}</div>
          ) : (
            items.map((item) => (
              <TrashItemRow
                key={item.id}
                item={item}
                retentionDays={retentionDays}
                isRestoring={pendingRestoreId === item.id}
                showSelection={isBatchMode}
                selected={selectedIds.has(item.id)}
                onSelectedChange={(selected) =>
                  setSelectedIds((current) => {
                    const next = new Set(current)
                    if (selected) next.add(item.id)
                    else next.delete(item.id)
                    return next
                  })
                }
                // One mutation instance backs every row, so a second in-flight action would
                // share and clobber its state — freeze the whole section until this one lands.
                isSectionBusy={isSectionBusy}
                onRestore={onRestore}
                onDelete={(target) => requestPermanentDelete([target], false)}
              />
            ))
          )}
          {pagination?.kind === 'cursor' && items.length > 0 && pagination.hasMore && (
            <div className="flex items-center justify-center">
              <Button variant="ghost" size="sm" loading={pagination.isLoadingMore} onClick={pagination.onLoadMore}>
                {t('settings.data.trash.load_more')}
              </Button>
            </div>
          )}
          {showOffsetControls && pagination?.kind === 'offset' && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="ghost" size="sm" disabled={!pagination.hasPrev} onClick={pagination.onPrevPage}>
                {t('settings.data.trash.page_prev')}
              </Button>
              <span className="text-muted-foreground text-xs">
                {pagination.page}/{Math.max(pagination.totalPages, pagination.page)}
              </span>
              <Button variant="ghost" size="sm" disabled={!pagination.hasNext} onClick={pagination.onNextPage}>
                {t('settings.data.trash.page_next')}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}

export default TrashSection
