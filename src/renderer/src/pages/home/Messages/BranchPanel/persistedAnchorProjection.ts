import type { PersistedBranchAnchorCandidate } from '@renderer/context/BranchAnchorContext'

import { pickNextColor } from './constants'
import type { Branch } from './types'
import type { PersistedBranchAnchor } from './usePersistedBranchAnchors'

interface ProjectPersistedBranchAnchorsInput {
  persistedAnchors: PersistedBranchAnchor[]
  branches: Branch[]
}

export function projectPersistedBranchAnchorCandidates({
  persistedAnchors,
  branches
}: ProjectPersistedBranchAnchorsInput): PersistedBranchAnchorCandidate[] {
  const liveBranchTopicIds = new Set(
    branches.map((branch) => branch.topic?.id).filter((id): id is string => Boolean(id))
  )
  const usedColors = branches.map((branch) => branch.color)
  const candidates: PersistedBranchAnchorCandidate[] = []

  for (const anchor of persistedAnchors) {
    if (liveBranchTopicIds.has(anchor.branchTopicId)) continue

    const color = pickNextColor(usedColors)
    usedColors.push(color)

    candidates.push({
      id: anchor.id,
      branchTopicId: anchor.branchTopicId,
      branchId: `persisted:${anchor.id}`,
      blockId: anchor.blockId,
      selectedText: anchor.selectedText,
      selectionStart: anchor.selectionStart,
      selectionEnd: anchor.selectionEnd,
      color
    })
  }

  return candidates
}
