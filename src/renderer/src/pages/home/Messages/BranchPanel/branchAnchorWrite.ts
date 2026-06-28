import { type CreateBranchAnchorDto, CreateBranchAnchorSchema } from '@shared/data/api/schemas/branchAnchors'

import type { Branch } from './types'

function hasBranchTopic(branch: Branch): branch is Branch & { topic: NonNullable<Branch['topic']> } {
  return branch.topic !== null && Boolean(branch.topic.id)
}

export function canWriteBranchAnchor(
  branch: Branch
): branch is Branch & { disposition: 'kept'; topic: NonNullable<Branch['topic']> } {
  return branch.disposition === 'kept' && hasBranchTopic(branch)
}

const writtenBranchAnchorRef = new Set<string>()

function getBranchAnchorWriteKey(branch: Branch): string | null {
  if (!canWriteBranchAnchor(branch)) return null
  return branch.topic.id
}

export function shouldWriteBranchAnchorOnce(branch: Branch): boolean {
  const writeKey = getBranchAnchorWriteKey(branch)
  if (!writeKey) return false
  if (writtenBranchAnchorRef.has(writeKey)) return false
  writtenBranchAnchorRef.add(writeKey)
  return true
}

export function buildCreateBranchAnchorBody(parentTopicId: string, branch: Branch): CreateBranchAnchorDto | null {
  if (branch.disposition !== 'kept' || !hasBranchTopic(branch)) return null

  const candidate = {
    parentTopicId,
    branchTopicId: branch.topic.id,
    messageId: branch.source.messageId,
    blockId: branch.source.blockId,
    selectedText: branch.source.selectedText,
    selectionStart: branch.source.offsets.start,
    selectionEnd: branch.source.offsets.end
  }

  const parsed = CreateBranchAnchorSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export function resetBranchAnchorWriteGuardForTest(): void {
  writtenBranchAnchorRef.clear()
}
