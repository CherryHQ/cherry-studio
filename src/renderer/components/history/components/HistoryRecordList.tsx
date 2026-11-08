import { MessageSquareText } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { useCommandHandler } from '@renderer/hooks/command'
import { canRunFocusedResourceCommand } from '@renderer/utils/commandFocus'

import type { HistoryRecordDescriptor, HistoryRowActions, HistoryRowState } from '../historyRecordsDescriptor'
import type { SelectAllState } from '../useHistoryRecordsController'
import { formatHistoryTime, HistoryRecordRow, HistoryTableHeader, HistoryVirtualTable } from './HistoryTableParts'

const PERMANENT_DELETE_ACTION_IDS = new Set(['topic.delete-permanently', 'session.delete-permanently'])

function findPermanentDeleteAction(actions: readonly ResolvedAction[]): ResolvedAction | undefined {
  for (const action of actions) {
    if (
      PERMANENT_DELETE_ACTION_IDS.has(action.id) ||
      (action.commandId && PERMANENT_DELETE_ACTION_IDS.has(action.commandId))
    ) {
      return action
    }
    const nested = action.children.length > 0 ? findPermanentDeleteAction(action.children) : undefined
    if (nested) return nested
  }
  return undefined
}

function isRunnablePermanentDelete(action: ResolvedAction | undefined): action is ResolvedAction {
  return Boolean(action?.availability.visible && action.availability.enabled)
}

interface HistoryRecordListProps<T> {
  descriptor: HistoryRecordDescriptor<T>
  items: readonly T[]
  isLoading: boolean
  isSelected: (id: string) => boolean
  selectAllState: SelectAllState
  selectionDisabled: boolean
  onToggleSelection: (id: string, checked: boolean, selectRange?: boolean) => void
  onToggleSelectAll: (checked: boolean) => void
  onTogglePin: (item: T) => Promise<void>
}

interface HistoryRecordListRowProps<T> {
  descriptor: HistoryRecordDescriptor<T>
  isSelected: (id: string) => boolean
  item: T
  onToggleSelection: (id: string, checked: boolean, selectRange?: boolean) => void
  openRename: (id: string, name: string) => void
  onTogglePin: (item: T) => Promise<void>
  showFixedActionShadow: boolean
}

function HistoryRecordListRow<T>({ descriptor, item, ...props }: HistoryRecordListRowProps<T>) {
  const renderContent = (rowState: HistoryRowState) => (
    <HistoryRecordListRowContent descriptor={descriptor} item={item} rowState={rowState} {...props} />
  )
  return descriptor.renderRowState?.(item, renderContent) ?? renderContent({ isRenaming: false })
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
  onTogglePin,
  rowState,
  showFixedActionShadow
}: HistoryRecordListRowContentProps<T>) {
  const { t } = useTranslation()
  const id = descriptor.getId(item)
  const rowActions = descriptor.getRowActions(item, openRename, rowState)
  const pinned = descriptor.isPinned(id)
  const rowRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef(false)
  const rowActionsRef = useRef<HistoryRowActions>(rowActions)
  const rowStateRef = useRef(rowState)
  rowActionsRef.current = rowActions
  rowStateRef.current = rowState

  const canRunPermanentDelete = () => {
    if (pendingRef.current || rowStateRef.current.isRenaming) return false
    if (!canRunFocusedResourceCommand(rowRef.current)) return false
    return isRunnablePermanentDelete(findPermanentDeleteAction(rowActionsRef.current.actions))
  }

  useCommandHandler(
    'resource.delete_permanently',
    () => {
      if (pendingRef.current || !canRunPermanentDelete()) return Promise.resolve()
      const action = findPermanentDeleteAction(rowActionsRef.current.actions)
      if (!isRunnablePermanentDelete(action)) return Promise.resolve()
      pendingRef.current = true
      try {
        return Promise.resolve(rowActionsRef.current.onAction(action)).finally(() => {
          pendingRef.current = false
        })
      } catch (error) {
        pendingRef.current = false
        throw error
      }
    },
    { enabled: () => canRunPermanentDelete() }
  )

  const row = (
    <HistoryRecordRow
      actions={rowActions.actions}
      rowRef={rowRef}
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
      onSelectedChange={(checked, selectRange) => onToggleSelection(id, checked, selectRange)}
      onTogglePin={() => onTogglePin(item)}
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
  onToggleSelectAll,
  onTogglePin
}: HistoryRecordListProps<T>) {
  const { t } = useTranslation()
  const list = useMemo(() => Array.from(items), [items])
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [showFixedActionShadow, setShowFixedActionShadow] = useState(false)
  const {
    getId,
    getName,
    renderRowState,
    getRowActions,
    getSelectLabel,
    getSourceLabel,
    getUpdatedAt,
    isPinned,
    onOpen,
    onRename,
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
      renderRowState,
      getRowActions,
      getSelectLabel,
      getSourceLabel,
      getUpdatedAt,
      isPinned,
      onOpen,
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
          onTogglePin={onTogglePin}
          openRename={openRename}
          showFixedActionShadow={showFixedActionShadow}
        />
      )
    },
    [getId, isSelected, onTogglePin, onToggleSelection, openRename, rowDescriptor, showFixedActionShadow]
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
