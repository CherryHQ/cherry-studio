import { Button, EmptyState } from '@cherrystudio/ui'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { AlertCircle, LoaderCircle, MessageSquareText, RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { HistoryRecordDescriptor } from '../historyRecordsDescriptor'
import type { SelectAllState } from '../useHistoryRecordsController'
import { formatHistoryTime, HistoryRecordRow, HistoryTableHeader, HistoryVirtualTable } from './HistoryTableParts'

interface HistoryRecordListProps<T> {
  descriptor: HistoryRecordDescriptor<T>
  items: readonly T[]
  error?: Error
  isLoading: boolean
  isLoadingMore?: boolean
  isSelected: (id: string) => boolean
  selectAllState: SelectAllState
  selectionDisabled: boolean
  onToggleSelection: (id: string, checked: boolean) => void
  onToggleSelectAll: (checked: boolean) => void
  /** Load the next cursor page when the scroller nears its bottom. */
  onEndReached?: () => void
  onRetry?: () => void
}

export function HistoryRecordList<T>({
  descriptor,
  items,
  error,
  isLoading,
  isLoadingMore = false,
  isSelected,
  selectAllState,
  selectionDisabled,
  onToggleSelection,
  onToggleSelectAll,
  onEndReached,
  onRetry
}: HistoryRecordListProps<T>) {
  const { t } = useTranslation()
  const list = useMemo(() => Array.from(items), [items])
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [showFixedActionShadow, setShowFixedActionShadow] = useState(false)
  const {
    getId,
    getName,
    getRowActions,
    getSelectLabel,
    getSourceLabel,
    getUpdatedAt,
    isPinned,
    onOpen,
    onRename,
    onTogglePin,
    renderAvatar,
    renderRowMenu,
    rowHeight,
    strings: { deleteLabel, pinLabel, unpinLabel }
  } = descriptor

  const openRename = useCallback((id: string, name: string) => setRenameTarget({ id, name }), [])
  const handleRenameSubmit = useCallback(
    (name: string) => {
      if (!renameTarget) return
      void onRename(renameTarget.id, name)
    },
    [onRename, renameTarget]
  )
  const handleRenameOpenChange = useCallback((open: boolean) => {
    if (!open) setRenameTarget(null)
  }, [])

  const emptyTitle = error
    ? t('common.error')
    : isLoading
      ? descriptor.strings.loadingTitle
      : descriptor.strings.emptyTitle
  const emptyDescription = error
    ? error.message
    : isLoading
      ? descriptor.strings.loadingDescription
      : descriptor.strings.emptyDescription
  const emptyContent = (
    <div className="flex min-h-[320px] items-center justify-center px-5 py-8">
      <EmptyState
        compact
        icon={error ? AlertCircle : MessageSquareText}
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={error && onRetry ? t('common.retry') : undefined}
        onAction={error ? onRetry : undefined}
      />
    </div>
  )

  const header = (
    <HistoryTableHeader
      actionsLabel={t('history.records.table.actions')}
      selectAllLabel={t('common.select_all')}
      selectedState={selectAllState}
      selectionDisabled={selectionDisabled}
      sourceLabel={descriptor.strings.sourceLabel}
      showFixedActionShadow={showFixedActionShadow}
      timeLabel={t('history.records.table.time')}
      titleLabel={descriptor.strings.titleColumnLabel}
      onToggleAll={onToggleSelectAll}
    />
  )

  const renderRow = useCallback(
    (item: T) => {
      const id = getId(item)
      const rowActions = getRowActions(item, openRename)
      const pinned = isPinned(id)
      const row = (
        <HistoryRecordRow
          actions={rowActions.actions}
          avatar={renderAvatar(item)}
          deleteLabel={deleteLabel}
          isPinned={pinned}
          isSelected={!pinned && isSelected(id)}
          minHeight={rowHeight}
          pinLabel={pinLabel}
          selectLabel={getSelectLabel(item)}
          showFixedActionShadow={showFixedActionShadow}
          sourceLabel={getSourceLabel(item)}
          timeLabel={formatHistoryTime(getUpdatedAt(item), t)}
          title={getName(item)}
          unpinLabel={unpinLabel}
          onAction={rowActions.onAction}
          onOpen={() => onOpen(item)}
          onSelectedChange={(checked) => onToggleSelection(id, checked)}
          onTogglePin={async () => {
            // Pinning a selected row makes it unselectable, so drop it from the selection after success
            // (a no-op when unpinning, since pinned rows are never selected).
            const result = await onTogglePin(item)
            if (result !== false) {
              onToggleSelection(id, false)
            }
          }}
        />
      )

      return renderRowMenu(item, row, rowActions)
    },
    [
      deleteLabel,
      getId,
      getName,
      getRowActions,
      getSelectLabel,
      getSourceLabel,
      getUpdatedAt,
      isPinned,
      isSelected,
      onOpen,
      onTogglePin,
      onToggleSelection,
      openRename,
      pinLabel,
      renderAvatar,
      renderRowMenu,
      rowHeight,
      showFixedActionShadow,
      t,
      unpinLabel
    ]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <HistoryVirtualTable
        emptyContent={emptyContent}
        estimateSize={() => descriptor.rowHeight}
        header={header}
        items={list}
        onFixedActionShadowChange={setShowFixedActionShadow}
        onEndReached={onEndReached}
        renderRow={renderRow}
      />
      {list.length > 0 && (error || isLoadingMore) ? (
        <div
          className="flex h-9 shrink-0 items-center justify-center gap-2 border-border-subtle border-t px-3 text-foreground-muted text-xs"
          role={error ? 'alert' : 'status'}>
          {error ? (
            <>
              <AlertCircle size={14} className="shrink-0 text-destructive" />
              <span className="max-w-md truncate" title={error.message}>
                {error.message}
              </span>
              {onRetry ? (
                <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={onRetry}>
                  <RefreshCw size={13} />
                  <span>{t('common.retry')}</span>
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <LoaderCircle size={14} className="animate-spin" />
              <span>{t('common.loading')}</span>
            </>
          )}
        </div>
      ) : null}
      <EditNameDialog
        open={!!renameTarget}
        title={descriptor.strings.renameDialogTitle}
        initialName={renameTarget?.name ?? ''}
        onSubmit={handleRenameSubmit}
        onOpenChange={handleRenameOpenChange}
      />
    </div>
  )
}
