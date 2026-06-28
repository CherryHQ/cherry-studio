import type { Branch } from './types'

function hasBranchTopic(branch: Branch): branch is Branch & { topic: NonNullable<Branch['topic']> } {
  return branch.topic !== null && Boolean(branch.topic.id)
}

export function canWriteBranchAnchor(branch: Branch): boolean {
  return branch.disposition === 'kept' && hasBranchTopic(branch)
}

const writtenBranchAnchorRef = new Set<string>()

export function shouldWriteBranchAnchorOnce(branch: Branch): boolean {
  if (!canWriteBranchAnchor(branch)) return false
  if (writtenBranchAnchorRef.has(branch.id)) return false
  writtenBranchAnchorRef.add(branch.id)
  return true
}

export function resetBranchAnchorWriteGuardForTest(): void {
  writtenBranchAnchorRef.clear()
}
