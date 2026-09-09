import { isMac } from '@renderer/utils/platform'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { HistoryRecordDescriptor } from '../historyRecordsDescriptor'
import type { HistoryRecordsController } from '../useHistoryRecordsController'
import { HistoryRecordList } from './HistoryRecordList'
import HistoryTopBar from './HistoryTopBar'

interface HistoryRecordsContentProps<T> {
  descriptor: HistoryRecordDescriptor<T>
  controller: HistoryRecordsController<T>
  isLoading: boolean
  /** Leading navbar slot (the shared sidebar toggle), mirrors ConversationResourceView. */
  toolbarLeading?: ReactNode
}

/** ToB list surface: one top bar (toggle · search · filters · bulk actions) above a virtualized table. */
export function HistoryRecordsContent<T>({
  descriptor,
  controller,
  isLoading,
  toolbarLeading
}: HistoryRecordsContentProps<T>) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLElement>(null)
  const { selectionDisabled, toggleSelectAll } = controller

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        selectionDisabled ||
        !(isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'a'
      )
        return

      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target !== document.body && !contentRef.current?.contains(target)) return
      if (target.isContentEditable) return
      if (
        !target.closest('[data-history-selection-checkbox], [data-history-record-title]') &&
        target.closest('a[href], button, input, select, textarea, [role="button"], [role="menuitem"]')
      )
        return

      event.preventDefault()
      toggleSelectAll(true)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectionDisabled, toggleSelectAll])

  return (
    <section
      ref={contentRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card pb-3 text-card-foreground"
      aria-label={t('history.records.shortTitle')}>
      <HistoryTopBar
        mode={descriptor.mode}
        toolbarLeading={toolbarLeading}
        searchText={controller.searchText}
        searchPlaceholder={descriptor.strings.searchPlaceholder}
        onSearchTextChange={controller.setSearchText}
        selectedSourceId={controller.selectedSourceId}
        onSourceSelect={controller.setSelectedSourceId}
        renderSourceFilter={descriptor.renderSourceFilter}
        statusOptions={descriptor.statusOptions}
        statusLabel={t('history.records.filter.statusLabel')}
        statusPlaceholder={t('history.records.filter.statusPlaceholder')}
        selectedStatus={controller.selectedStatus}
        onStatusSelect={controller.setSelectedStatus}
        selectedCount={controller.selectedCount}
        bulkDeleteCount={controller.bulkDeleteCount}
        bulkMoveTargets={descriptor.bulkMoveTargets}
        onBulkDelete={controller.handleBulkDelete}
        onBulkMove={descriptor.onBulkMove ? controller.handleBulkMove : undefined}
      />

      <HistoryRecordList
        descriptor={descriptor}
        items={controller.visibleItems}
        isLoading={isLoading}
        isSelected={controller.isSelected}
        selectAllState={controller.selectAllState}
        selectionDisabled={controller.selectionDisabled}
        onToggleSelection={controller.toggleSelection}
        onToggleSelectAll={controller.toggleSelectAll}
        onTogglePin={controller.handleTogglePin}
      />
    </section>
  )
}
