import { useQuery } from '@data/hooks/useDataApi'
import type { BranchAnchor as PersistedBranchAnchorDto } from '@shared/data/types/branchAnchor'
import { useMemo } from 'react'

export type PersistedBranchAnchorHydrationStatus = 'unresolved'

export interface PersistedBranchAnchor {
  id: PersistedBranchAnchorDto['id']
  parentTopicId: PersistedBranchAnchorDto['parentTopicId']
  branchTopicId: PersistedBranchAnchorDto['branchTopicId']
  messageId: PersistedBranchAnchorDto['messageId']
  blockId: PersistedBranchAnchorDto['blockId']
  selectionStart: PersistedBranchAnchorDto['selectionStart']
  selectionEnd: PersistedBranchAnchorDto['selectionEnd']
  selectedText: PersistedBranchAnchorDto['selectedText']
  summary: PersistedBranchAnchorDto['summary']
  summaryUpdatedAt: PersistedBranchAnchorDto['summaryUpdatedAt']
  hydrationStatus: PersistedBranchAnchorHydrationStatus
  skippedReason: undefined
  resolvedSelectionStart: undefined
  resolvedSelectionEnd: undefined
}

interface UsePersistedBranchAnchorsResult {
  anchors: PersistedBranchAnchor[]
  isLoading: boolean
  error: Error | undefined
  refetch: () => Promise<unknown>
}

export function normalizePersistedBranchAnchor(anchor: PersistedBranchAnchorDto): PersistedBranchAnchor {
  return {
    id: anchor.id,
    parentTopicId: anchor.parentTopicId,
    branchTopicId: anchor.branchTopicId,
    messageId: anchor.messageId,
    blockId: anchor.blockId,
    selectionStart: anchor.selectionStart,
    selectionEnd: anchor.selectionEnd,
    selectedText: anchor.selectedText,
    summary: anchor.summary,
    summaryUpdatedAt: anchor.summaryUpdatedAt,
    hydrationStatus: 'unresolved',
    skippedReason: undefined,
    resolvedSelectionStart: undefined,
    resolvedSelectionEnd: undefined
  }
}

export function normalizePersistedBranchAnchors(
  anchors: PersistedBranchAnchorDto[] | undefined,
  parentTopicId: string | null | undefined
): PersistedBranchAnchor[] {
  if (!parentTopicId || !anchors) return []

  return anchors
    .filter((anchor) => anchor.parentTopicId === parentTopicId)
    .map((anchor) => normalizePersistedBranchAnchor(anchor))
}

export function usePersistedBranchAnchors(parentTopicId: string | null | undefined): UsePersistedBranchAnchorsResult {
  const enabled = Boolean(parentTopicId)
  const { data, isLoading, error, refetch } = useQuery('/topics/:id/branch-anchors', {
    params: { id: parentTopicId ?? '' },
    enabled,
    swrOptions: { keepPreviousData: false }
  })

  const anchors = useMemo(() => normalizePersistedBranchAnchors(data, parentTopicId), [data, parentTopicId])

  return useMemo(
    () => ({
      anchors,
      isLoading,
      error,
      refetch
    }),
    [anchors, error, isLoading, refetch]
  )
}
