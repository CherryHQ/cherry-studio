import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { HistoryRecordDescriptor } from '../historyRecordsDescriptor'
import { ALL_SOURCE_ID } from '../historyRecordsHelpers'
import type { HistoryRecordsController } from '../useHistoryRecordsController'
import { HistoryRecordList } from './HistoryRecordList'
import HistoryTopBar from './HistoryTopBar'

interface HistoryRecordsContentProps<T> {
  descriptor: HistoryRecordDescriptor<T>
  controller: HistoryRecordsController<T>
  error?: Error
  isLoading: boolean
  isLoadingMore?: boolean
  /** Leading navbar slot (the shared sidebar toggle), mirrors ConversationResourceView. */
  toolbarLeading?: ReactNode
  /** Load the next cursor page when the list nears its bottom. */
  onEndReached?: () => void
  onRetry?: () => void
}

/** ToB list surface: one top bar (toggle · search · filters · bulk actions) above a virtualized table. */
export function HistoryRecordsContent<T>({
  descriptor,
  controller,
  error,
  isLoading,
  isLoadingMore,
  toolbarLeading,
  onEndReached,
  onRetry
}: HistoryRecordsContentProps<T>) {
  const { t } = useTranslation()
  const hasActiveFilters = controller.searchText.trim().length > 0 || controller.selectedSourceId !== ALL_SOURCE_ID
  const clearFilters = () => {
    controller.setSearchText('')
    controller.setSelectedSourceId(ALL_SOURCE_ID)
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card pb-3 text-foreground"
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
        selectedCount={controller.selectedCount}
        bulkDeleteCount={controller.bulkDeleteCount}
        bulkMoveTargets={descriptor.bulkMoveTargets}
        onBulkDelete={controller.handleBulkDelete}
        onBulkMove={descriptor.onBulkMove ? controller.handleBulkMove : undefined}
      />

      <HistoryRecordList
        descriptor={descriptor}
        items={controller.visibleItems}
        error={error}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasActiveFilters={hasActiveFilters}
        isSelected={controller.isSelected}
        selectAllState={controller.selectAllState}
        selectionDisabled={controller.selectionDisabled}
        onToggleSelection={controller.toggleSelection}
        onToggleSelectAll={controller.toggleSelectAll}
        onEndReached={onEndReached}
        onRetry={onRetry}
        onClearFilters={clearFilters}
      />
    </section>
  )
}
