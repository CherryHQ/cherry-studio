// Only the exclusive suffix belongs to one path, so deletion must stop below its nearest shared ancestor.
import type { TreeNode, TreeResponse } from '@shared/data/types/message'

export interface BranchDeletionPlan {
  /** ids the request will remove, from the exclusive suffix; empty when not deletable */
  rangeIds: string[]
  /** true when the selected node is a still-empty reservation (deletable alone) */
  awaitingInputOnly: boolean
  /** why the action is unavailable; undefined when available */
  reason?: 'not-persisted' | 'incomplete-subtree' | 'multiple-leaves' | 'only-path' | 'pending'
}

export function planBranchDeletion(tree: TreeResponse, messageId: string): BranchDeletionPlan {
  const nodes = new Map<string, TreeNode>(tree.nodes.map((node) => [node.id, node]))
  for (const group of tree.siblingsGroups) {
    for (const node of group.nodes) nodes.set(node.id, { ...node, parentId: group.parentId })
  }
  const unavailable = (reason: BranchDeletionPlan['reason']): BranchDeletionPlan => ({
    rangeIds: [],
    awaitingInputOnly: false,
    reason
  })
  const selected = nodes.get(messageId)
  if (!selected) return unavailable('not-persisted')

  const children = new Map<string, TreeNode[]>()
  for (const node of nodes.values()) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }

  const leaves: TreeNode[] = []
  const remaining = [selected]
  while (remaining.length > 0) {
    const node = remaining.pop()!
    const descendants = children.get(node.id) ?? []
    if (node.hasChildren && descendants.length === 0) return unavailable('incomplete-subtree')
    if (descendants.length === 0) leaves.push(node)
    else remaining.push(...descendants)
  }
  if (selected.isAwaitingInput) return { rangeIds: [messageId], awaitingInputOnly: true }
  if (leaves.length !== 1) return unavailable('multiple-leaves')

  const rangeIds: string[] = []
  let current = leaves[0]
  while (current.parentId != null) {
    rangeIds.push(current.id)
    if ((children.get(current.parentId)?.length ?? 0) > 1) break
    const parent = nodes.get(current.parentId)
    if (!parent || parent.parentId == null) return unavailable('only-path')
    current = parent
  }
  if (rangeIds.length === 0) return unavailable('only-path')
  if (rangeIds.some((id) => nodes.get(id)?.status === 'pending')) return unavailable('pending')
  return { rangeIds, awaitingInputOnly: false }
}
