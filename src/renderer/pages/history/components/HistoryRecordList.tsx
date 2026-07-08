import { EmptyState } from '@cherrystudio/ui'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { MessageSquareText } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { HistoryRecordDescriptor } from '../historyRecordsDescriptor'
import type { SelectAllState } from '../useHistoryRecordsController'
import { formatHistoryTime, HistoryRecordRow, HistoryTableHeader, HistoryVirtualTable } from './HistoryTableParts'

interface HistoryRecordListProps<T> {
  descriptor: HistoryRecordDescriptor<T>
  items: readonly T[]
  isLoading: boolean
  isSelected: (id: string) => boolean
  selectAllState: SelectAllState
  selectionDisabled: boolean
  onToggleSelection: (id: string, checked: boolean) => void
  onToggleSelectAll: (checked: boolean) => void
}

export function HistoryRecordList<T>({
  descriptor,
  items,
  isLoading,
  isSelected,
  selectAllState,
  selectionDisabled,
  onToggleSelection,
  onToggleSelectAll
}: HistoryRecordListProps<T>) {
  const { t } = useTranslation()
  const list = useMemo(() => Array.from(items), [items])
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [showFixedActionShadow, setShowFixedActionShadow] = useState(false)

  const openRename = useCallback((id: string, name: string) => setRenameTarget({ id, name }), [])
  const handleRenameSubmit = useCallback(
    (name: string) => {
      if (!renameTarget) return
      void descriptor.onRename(renameTarget.id, name)
    },
    [descriptor, renameTarget]
  )
  const handleRenameOpenChange = useCallback((open: boolean) => {
    if (!open) setRenameTarget(null)
  }, [])

  const emptyTitle = isLoading ? descriptor.strings.loadingTitle : descriptor.strings.emptyTitle
  const emptyDescription = isLoading ? descriptor.strings.loadingDescription : descriptor.strings.emptyDescription
  const emptyContent = (
    <div className="flex min-h-[320px] items-center justify-center px-5 py-8">
      <EmptyState compact icon={MessageSquareText} title={emptyTitle} description={emptyDescription} />
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
      const id = descriptor.getId(item)
      const rowActions = descriptor.getRowActions(item, openRename)
      const isPinned = descriptor.isPinned(id)
      const row = (
        <HistoryRecordRow
          actions={rowActions.actions}
          avatar={descriptor.renderAvatar(item)}
          deleteLabel={descriptor.strings.deleteLabel}
          description={descriptor.getDescription?.(item)}
          isPinned={isPinned}
          isSelected={!isPinned && isSelected(id)}
          minHeight={descriptor.rowHeight}
          pinLabel={descriptor.strings.pinLabel}
          selectLabel={descriptor.getSelectLabel(item)}
          showFixedActionShadow={showFixedActionShadow}
          sourceLabel={descriptor.getSourceLabel(item)}
          timeLabel={formatHistoryTime(descriptor.getUpdatedAt(item), t)}
          title={descriptor.getName(item)}
          unpinLabel={descriptor.strings.unpinLabel}
          onAction={rowActions.onAction}
          onOpen={() => descriptor.onOpen(item)}
          onSelectedChange={(checked) => onToggleSelection(id, checked)}
          onTogglePin={() => {
            // Pinning a selected row makes it unselectable, so drop it from the selection right away
            // (a no-op when unpinning, since pinned rows are never selected).
            onToggleSelection(id, false)
            return descriptor.onTogglePin(item)
          }}
        />
      )

      return descriptor.renderRowMenu(item, row, rowActions)
    },
    [descriptor, isSelected, onToggleSelection, openRename, showFixedActionShadow, t]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <HistoryVirtualTable
        emptyContent={emptyContent}
        estimateSize={() => descriptor.rowHeight}
        header={header}
        items={list}
        onFixedActionShadowChange={setShowFixedActionShadow}
        renderRow={renderRow}
      />
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
