import { EmptyState } from '@cherrystudio/ui'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { useCacheSelector } from '@renderer/data/hooks/useCache'
import { MessageSquareText } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { HistoryRecordDescriptor, HistoryRowState } from '../historyRecordsDescriptor'
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

interface HistoryRecordListRowProps<T> {
  descriptor: HistoryRecordDescriptor<T>
  isSelected: (id: string) => boolean
  item: T
  onToggleSelection: (id: string, checked: boolean) => void
  openRename: (id: string, name: string) => void
  showFixedActionShadow: boolean
}

function HistoryRecordListRow<T>({ descriptor, item, ...props }: HistoryRecordListRowProps<T>) {
  const renameTopicId = descriptor.getRenameTopicId?.(item)

  if (renameTopicId) {
    return <HistoryRecordListRenameRow descriptor={descriptor} item={item} renameTopicId={renameTopicId} {...props} />
  }

  return <HistoryRecordListRowContent descriptor={descriptor} item={item} rowState={{ isRenaming: false }} {...props} />
}

interface HistoryRecordListRenameRowProps<T> extends HistoryRecordListRowProps<T> {
  renameTopicId: string
}

function HistoryRecordListRenameRow<T>({ renameTopicId, ...props }: HistoryRecordListRenameRowProps<T>) {
  const isRenaming = useCacheSelector(
    ['topic.renaming'] as const,
    ([topicIds]) => topicIds?.includes(renameTopicId) ?? false
  )

  return <HistoryRecordListRowContent {...props} rowState={{ isRenaming }} />
}

interface HistoryRecordListRowContentProps<T> extends HistoryRecordListRowProps<T> {
  rowState: HistoryRowState
}

function HistoryRecordListRowContent<T>({
  descriptor,
  isSelected,
  item,
  onToggleSelection,
  openRename,
  rowState,
  showFixedActionShadow
}: HistoryRecordListRowContentProps<T>) {
  const { t } = useTranslation()
  const id = descriptor.getId(item)
  const rowActions = descriptor.getRowActions(item, openRename, rowState)
  const pinned = descriptor.isPinned(id)
  const row = (
    <HistoryRecordRow
      actions={rowActions.actions}
      avatar={descriptor.renderAvatar(item)}
      deleteLabel={descriptor.strings.deleteLabel}
      isPinned={pinned}
      isSelected={!pinned && isSelected(id)}
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
      onTogglePin={async () => {
        // Pinning a selected row makes it unselectable, so drop it from the selection after success
        // (a no-op when unpinning, since pinned rows are never selected).
        const result = await descriptor.onTogglePin(item)
        if (result !== false) {
          onToggleSelection(id, false)
        }
      }}
    />
  )

  return descriptor.renderRowMenu(item, row, rowActions)
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
  const {
    getId,
    getName,
    getRenameTopicId,
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
  // The aggregate descriptor is recreated by each mode; memoize on the row fields instead.
  const rowDescriptor = useMemo<HistoryRecordDescriptor<T>>(
    () => descriptor,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- descriptor identity is intentionally excluded.
    [
      deleteLabel,
      getId,
      getName,
      getRenameTopicId,
      getRowActions,
      getSelectLabel,
      getSourceLabel,
      getUpdatedAt,
      isPinned,
      onOpen,
      onTogglePin,
      pinLabel,
      renderAvatar,
      renderRowMenu,
      rowHeight,
      unpinLabel
    ]
  )

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
      return (
        <HistoryRecordListRow
          key={getId(item)}
          descriptor={rowDescriptor}
          isSelected={isSelected}
          item={item}
          onToggleSelection={onToggleSelection}
          openRename={openRename}
          showFixedActionShadow={showFixedActionShadow}
        />
      )
    },
    [getId, isSelected, onToggleSelection, openRename, rowDescriptor, showFixedActionShadow]
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
