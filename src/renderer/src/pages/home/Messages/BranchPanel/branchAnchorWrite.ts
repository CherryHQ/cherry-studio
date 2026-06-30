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

type BranchAnchorPersistenceState =
  | { status: 'creating' }
  | { status: 'created'; anchorId: string }
  | { status: 'deleting'; anchorId: string }

const branchAnchorPersistenceRef = new Map<string, BranchAnchorPersistenceState>()

function getBranchAnchorWriteKey(branch: Branch): string | null {
  if (!canWriteBranchAnchor(branch)) return null
  return branch.topic.id
}

export function shouldWriteBranchAnchorOnce(branch: Branch): boolean {
  const writeKey = getBranchAnchorWriteKey(branch)
  if (!writeKey) return false
  return claimBranchAnchorCreate(writeKey)
}

export function getBranchAnchorTopicKey(branch: Branch): string | null {
  return hasBranchTopic(branch) ? branch.topic.id : null
}

export function claimBranchAnchorCreate(branchTopicId: string): boolean {
  if (branchAnchorPersistenceRef.has(branchTopicId)) return false
  branchAnchorPersistenceRef.set(branchTopicId, { status: 'creating' })
  return true
}

export function markBranchAnchorCreated(branchTopicId: string, anchorId: string): void {
  branchAnchorPersistenceRef.set(branchTopicId, { status: 'created', anchorId })
}

export function clearBranchAnchorCreateGuard(branchTopicId: string): void {
  const state = branchAnchorPersistenceRef.get(branchTopicId)
  if (state?.status === 'creating') {
    branchAnchorPersistenceRef.delete(branchTopicId)
  }
}

export function claimBranchAnchorDelete(branchTopicId: string): string | null {
  const state = branchAnchorPersistenceRef.get(branchTopicId)
  if (state?.status !== 'created') return null

  branchAnchorPersistenceRef.set(branchTopicId, { status: 'deleting', anchorId: state.anchorId })
  return state.anchorId
}

export function markBranchAnchorDeleted(branchTopicId: string, anchorId: string): void {
  const state = branchAnchorPersistenceRef.get(branchTopicId)
  if (state?.status === 'deleting' && state.anchorId === anchorId) {
    branchAnchorPersistenceRef.delete(branchTopicId)
  }
}

export function markBranchAnchorDeleteFailed(branchTopicId: string, anchorId: string): void {
  const state = branchAnchorPersistenceRef.get(branchTopicId)
  if (state?.status === 'deleting' && state.anchorId === anchorId) {
    branchAnchorPersistenceRef.set(branchTopicId, { status: 'created', anchorId })
  }
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
  branchAnchorPersistenceRef.clear()
}
