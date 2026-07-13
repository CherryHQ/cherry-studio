import { useCallback, useEffect, useMemo, useState } from 'react'

import type { HistoryRecordDescriptor } from './historyRecordsDescriptor'
import { ALL_SOURCE_ID, findAdjacentHistoryRecordAfterBulkDelete } from './historyRecordsHelpers'
import type { HistorySourceStatus } from './historyRecordsTypes'

/**
 * Filter state owned by the mode wrapper (not this hook) because it drives the
 * wrapper's server-side query: search and source scope are applied by the
 * server (D1/D6 of #16890), so the state must exist before the data hook runs.
 */
export interface HistoryRecordsFilterState {
  searchText: string
  setSearchText: (value: string) => void
  selectedSourceId: string
  setSelectedSourceId: (id: string) => void
  selectedStatus: HistorySourceStatus
  setSelectedStatus: (status: HistorySourceStatus) => void
}

interface UseHistoryRecordsControllerParams<T> {
  descriptor: HistoryRecordDescriptor<T>
  /**
   * The loaded window of server-filtered records. The wrapper selects activity
   * order for the all-source view and manual order for a concrete source;
   * runtime status (agent mode) remains renderer-owned because it lives in
   * SharedCache, not SQLite (D7 of #16890).
   */
  items: readonly T[]
  filters: HistoryRecordsFilterState
  activeRecordId?: string | null
}

export type SelectAllState = boolean | 'indeterminate'

export interface HistoryRecordsController<T> {
  searchText: string
  setSearchText: (value: string) => void
  selectedSourceId: string
  setSelectedSourceId: (id: string) => void
  selectedStatus: HistorySourceStatus
  setSelectedStatus: (status: HistorySourceStatus) => void
  visibleItems: readonly T[]
  selectedIds: string[]
  selectedCount: number
  bulkDeleteCount: number
  selectAllState: SelectAllState
  selectionDisabled: boolean
  isSelected: (id: string) => boolean
  toggleSelection: (id: string, checked: boolean) => void
  toggleSelectAll: (checked: boolean) => void
  handleBulkDelete: () => Promise<void>
  handleBulkMove: (targetId: string) => Promise<void>
}

/**
 * Owns the selection state and batch handlers shared by both history modes.
 * The mode-specific data wiring lives in the descriptor and the wrapper's
 * server query; this hook stays entity-agnostic.
 *
 * Selection semantics (D7 of #16890): "select all" selects only the rows
 * displayed at that moment; pages loaded afterwards are not auto-selected;
 * and changing source, status, or search clears the selection so rows
 * scrolled out of the new result set cannot be changed accidentally.
 */
export function useHistoryRecordsController<T>({
  descriptor,
  items,
  filters,
  activeRecordId
}: UseHistoryRecordsControllerParams<T>): HistoryRecordsController<T> {
  const { getId, isPinned, statusOf, sources, onBulkDelete, onActiveRecordChange, onBulkMove } = descriptor
  const { searchText, setSearchText, selectedSourceId, setSelectedSourceId, selectedStatus, setSelectedStatus } =
    filters

  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const visibleItems = useMemo(() => {
    if (!statusOf || selectedStatus === ALL_SOURCE_ID) return items
    return items.filter((item) => statusOf(item) === selectedStatus)
  }, [items, selectedStatus, statusOf])

  // Reset the source filter when the selected source disappears (e.g. its assistant was deleted).
  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (sources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [selectedSourceId, setSelectedSourceId, sources])

  // Filter changes swap the visible result set — clear the selection outright.
  useEffect(() => {
    setSelectedIds([])
  }, [searchText, selectedSourceId, selectedStatus])

  // Prune the selection down to currently-visible, non-pinned records (deletions, pins, refetches).
  useEffect(() => {
    const visibleSelectableIds = new Set(
      visibleItems.filter((item) => !isPinned(getId(item))).map((item) => getId(item))
    )
    setSelectedIds((ids) => {
      const next = ids.filter((id) => visibleSelectableIds.has(id))
      return next.length === ids.length ? ids : next
    })
  }, [getId, isPinned, visibleItems])

  const selectableIds = useMemo(
    () => visibleItems.filter((item) => !isPinned(getId(item))).map((item) => getId(item)),
    [getId, isPinned, visibleItems]
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedDeletableIds = useMemo(() => selectedIds.filter((id) => !isPinned(id)), [isPinned, selectedIds])
  const selectedSelectableCount = useMemo(
    () => selectableIds.filter((id) => selectedIdSet.has(id)).length,
    [selectableIds, selectedIdSet]
  )
  const selectAllState: SelectAllState =
    selectableIds.length > 0 && selectedSelectableCount === selectableIds.length
      ? true
      : selectedSelectableCount > 0
        ? 'indeterminate'
        : false

  const isSelected = useCallback((id: string) => selectedIdSet.has(id), [selectedIdSet])

  const toggleSelection = useCallback(
    (id: string, checked: boolean) => {
      if (checked && isPinned(id)) return

      setSelectedIds((ids) =>
        checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((current) => current !== id)
      )
    },
    [isPinned]
  )

  const toggleSelectAll = useCallback(
    (checked: boolean) => setSelectedIds(checked ? selectableIds : []),
    [selectableIds]
  )

  const handleBulkDelete = useCallback(async () => {
    const ids = selectedDeletableIds
    if (ids.length === 0) return

    const deletedIds = await onBulkDelete(ids)
    if (!deletedIds) return

    const deletedIdSet = new Set(deletedIds)
    setSelectedIds((current) => current.filter((id) => !deletedIdSet.has(id)))

    if (activeRecordId && deletedIds.includes(activeRecordId)) {
      const nextItem = findAdjacentHistoryRecordAfterBulkDelete(items, deletedIds, activeRecordId, getId)
      onActiveRecordChange(nextItem ?? null)
    }
  }, [activeRecordId, getId, items, onActiveRecordChange, onBulkDelete, selectedDeletableIds])

  const handleBulkMove = useCallback(
    async (targetId: string) => {
      const ids = selectedIds
      if (ids.length === 0 || !onBulkMove) return

      const movedIds = await onBulkMove(targetId, ids)
      if (!movedIds) return

      const movedIdSet = new Set(movedIds)
      setSelectedIds((current) => current.filter((id) => !movedIdSet.has(id)))
    },
    [onBulkMove, selectedIds]
  )

  return {
    searchText,
    setSearchText,
    selectedSourceId,
    setSelectedSourceId,
    selectedStatus,
    setSelectedStatus,
    visibleItems,
    selectedIds,
    selectedCount: selectedIds.length,
    bulkDeleteCount: selectedDeletableIds.length,
    selectAllState,
    selectionDisabled: selectableIds.length === 0,
    isSelected,
    toggleSelection,
    toggleSelectAll,
    handleBulkDelete,
    handleBulkMove
  }
}

/**
 * Wrapper-owned filter state for a history mode. Split from the controller so
 * the wrapper can feed `searchText` / `selectedSourceId` into its server-side
 * query before the controller runs.
 */
export function useHistoryRecordsFilters(): HistoryRecordsFilterState {
  const [searchText, setSearchText] = useState('')
  const [selectedSourceId, setSelectedSourceId] = useState<string>(ALL_SOURCE_ID)
  const [selectedStatus, setSelectedStatus] = useState<HistorySourceStatus>(ALL_SOURCE_ID)

  return { searchText, setSearchText, selectedSourceId, setSelectedSourceId, selectedStatus, setSelectedStatus }
}
