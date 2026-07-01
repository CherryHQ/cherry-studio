import type { BranchAnchor as PersistedBranchAnchorDto } from '@shared/data/types/branchAnchor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { normalizePersistedBranchAnchor, type PersistedBranchAnchor } from './usePersistedBranchAnchors'

interface MergePersistedBranchAnchorsInput {
  serverAnchors: PersistedBranchAnchor[]
  promotedAnchors: PersistedBranchAnchor[]
  suppressedAnchorIds?: ReadonlySet<string>
}

interface UsePromotedPersistedBranchAnchorsResult {
  promotedAnchors: PersistedBranchAnchor[]
  suppressedAnchorIds: ReadonlySet<string>
  promoteAnchor: (anchor: PersistedBranchAnchorDto) => void
  removePromotedAnchor: (anchorId: string) => void
}

function upsertPromotedAnchor(
  anchors: PersistedBranchAnchor[],
  anchor: PersistedBranchAnchor
): PersistedBranchAnchor[] {
  return [...anchors.filter((item) => item.id !== anchor.id && item.branchTopicId !== anchor.branchTopicId), anchor]
}

export function mergePersistedBranchAnchors({
  serverAnchors,
  promotedAnchors,
  suppressedAnchorIds = new Set()
}: MergePersistedBranchAnchorsInput): PersistedBranchAnchor[] {
  const promotedIds = new Set(promotedAnchors.map((anchor) => anchor.id))
  const promotedBranchTopicIds = new Set(promotedAnchors.map((anchor) => anchor.branchTopicId))

  return [
    ...serverAnchors.filter(
      (anchor) =>
        !suppressedAnchorIds.has(anchor.id) &&
        !promotedIds.has(anchor.id) &&
        !promotedBranchTopicIds.has(anchor.branchTopicId)
    ),
    ...promotedAnchors
  ]
}

export function usePromotedPersistedBranchAnchors(
  parentTopicId: string | null | undefined
): UsePromotedPersistedBranchAnchorsResult {
  const parentTopicIdRef = useRef(parentTopicId)
  const [promotedAnchors, setPromotedAnchors] = useState<PersistedBranchAnchor[]>([])
  const [suppressedAnchorIds, setSuppressedAnchorIds] = useState<ReadonlySet<string>>(() => new Set())

  parentTopicIdRef.current = parentTopicId

  useEffect(() => {
    setPromotedAnchors([])
    setSuppressedAnchorIds(new Set())
  }, [parentTopicId])

  const promoteAnchor = useCallback((anchor: PersistedBranchAnchorDto) => {
    if (!parentTopicIdRef.current || anchor.parentTopicId !== parentTopicIdRef.current) return

    const normalized = normalizePersistedBranchAnchor(anchor)
    setPromotedAnchors((prev) => upsertPromotedAnchor(prev, normalized))
    setSuppressedAnchorIds((prev) => {
      if (!prev.has(anchor.id)) return prev

      const next = new Set(prev)
      next.delete(anchor.id)
      return next
    })
  }, [])

  const removePromotedAnchor = useCallback((anchorId: string) => {
    setPromotedAnchors((prev) => prev.filter((anchor) => anchor.id !== anchorId))
    setSuppressedAnchorIds((prev) => {
      const next = new Set(prev)
      next.add(anchorId)
      return next
    })
  }, [])

  return useMemo(
    () => ({
      promotedAnchors,
      suppressedAnchorIds,
      promoteAnchor,
      removePromotedAnchor
    }),
    [promoteAnchor, promotedAnchors, removePromotedAnchor, suppressedAnchorIds]
  )
}
