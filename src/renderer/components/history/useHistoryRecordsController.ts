import { useCallback, useEffect, useMemo, useState } from 'react'

import type { HistoryRecordDescriptor } from './historyRecordsDescriptor'
import { ALL_SOURCE_ID, findAdjacentHistoryRecordAfterBulkDelete } from './historyRecordsHelpers'
import type { HistorySourceStatus } from './historyRecordsTypes'

interface UseHistoryRecordsControllerParams<T> {
  descriptor: HistoryRecordDescriptor<T>
  /** Records sorted by recency (used when the source filter is "all" and for post-delete adjacency). */
  timeSorted: readonly T[]
  /** Records grouped/sorted by source (used when a specific source is selected). */
  sourceSorted: readonly T[]
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
  resultCount: number
  isSelected: (id: string) => boolean
  toggleSelection: (id: string, checked: boolean) => void
  toggleSelectAll: (checked: boolean) => void
  handleBulkDelete: () => Promise<void>
  handleBulkMove: (targetId: string) => Promise<void>
}

/**
 * Owns the state, filtering, selection and batch handlers shared by both history modes. The
 * mode-specific data wiring lives in the descriptor; this hook stays entity-agnostic.
 *
 * It reads the descriptor's fields individually (rather than depending on the descriptor object) so
 * that `visibleItems` stays referentially stable as long as the wrapper memoizes the filter
 * predicates + `sources` — keeping the virtualized list from thrashing on unrelated re-renders.
 */
export function useHistoryRecordsController<T>({
  descriptor,
  timeSorted,
  sourceSorted,
  activeRecordId
}: UseHistoryRecordsControllerParams<T>): HistoryRecordsController<T> {
  const {
    getId,
    isPinned,
    getSourceId,
    statusOf,
    matchesSearch,
    sources,
    onBulkDelete,
    onActiveRecordChange,
    onBulkMove
  } = descriptor

  const [searchText, setSearchText] = useState('')
  const [selectedSourceId, setSelectedSourceId] = useState<string>(ALL_SOURCE_ID)
  const [selectedStatus, setSelectedStatus] = useState<HistorySourceStatus>(ALL_SOURCE_ID)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const visibleItems = useMemo(() => {
    const base = selectedSourceId === ALL_SOURCE_ID ? timeSorted : sourceSorted

    const afterStatus =
      statusOf && selectedStatus !== ALL_SOURCE_ID ? base.filter((item) => statusOf(item) === selectedStatus) : base

    const afterSource =
      selectedSourceId === ALL_SOURCE_ID
        ? afterStatus
        : afterStatus.filter((item) => getSourceId(item) === selectedSourceId)

    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return afterSource

    return afterSource.filter((item) => matchesSearch(item, keywords))
  }, [getSourceId, matchesSearch, searchText, selectedSourceId, selectedStatus, sourceSorted, statusOf, timeSorted])

  // Reset the source filter when the selected source disappears (e.g. its assistant was deleted).
  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (sources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [selectedSourceId, sources])

  // Prune the selection down to currently-visible, non-pinned records.
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
      const nextItem = findAdjacentHistoryRecordAfterBulkDelete(timeSorted, deletedIds, activeRecordId, getId)
      onActiveRecordChange(nextItem ?? null)
    }
  }, [activeRecordId, getId, onActiveRecordChange, onBulkDelete, selectedDeletableIds, timeSorted])

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
    resultCount: visibleItems.length,
    isSelected,
    toggleSelection,
    toggleSelectAll,
    handleBulkDelete,
    handleBulkMove
  }
}
