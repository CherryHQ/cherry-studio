import { omit } from 'es-toolkit'
import { describe, expect, it } from 'vitest'

import type { TreeNode, TreeResponse } from '@shared/data/types/message'

import { planBranchDeletion } from '../topicBranchDeletion'

function node(id: string, parentId: string, overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    parentId,
    role: 'user',
    preview: id,
    status: 'success',
    createdAt: '2026-10-29T00:00:00.000Z',
    hasChildren: false,
    ...overrides
  }
}

function branchTree(): TreeResponse {
  return {
    rootId: 'root',
    activeNodeId: 'L',
    nodes: [
      node('F1', 'root', { hasChildren: true }),
      node('F2', 'F1', { role: 'assistant', hasChildren: true }),
      node('A', 'F2', { hasChildren: true }),
      node('B', 'A', { role: 'assistant', hasChildren: true }),
      node('L', 'B'),
      node('O', 'F2')
    ],
    siblingsGroups: []
  }
}

describe('planBranchDeletion', () => {
  it.each(['L', 'A'])('plans the whole exclusive suffix from %s and preserves the fork', (id) => {
    expect(planBranchDeletion(branchTree(), id)).toEqual({
      rangeIds: ['L', 'B', 'A'],
      awaitingInputOnly: false
    })
  })

  it('rejects a selected subtree with multiple leaves', () => {
    expect(planBranchDeletion(branchTree(), 'F2')).toEqual({
      rangeIds: [],
      awaitingInputOnly: false,
      reason: 'multiple-leaves'
    })
  })

  it('protects the only conversation path', () => {
    const tree = branchTree()
    tree.nodes = tree.nodes.filter((row) => row.id !== 'O')
    expect(planBranchDeletion(tree, 'L')).toEqual({ rangeIds: [], awaitingInputOnly: false, reason: 'only-path' })
  })

  it('rejects a truncated descendant even when another descendant is a visible leaf', () => {
    const tree = branchTree()
    tree.nodes.push(node('frontier', 'A', { hasChildren: true }))
    expect(planBranchDeletion(tree, 'A')).toEqual({
      rangeIds: [],
      awaitingInputOnly: false,
      reason: 'incomplete-subtree'
    })
  })

  it('rejects an id absent from persisted nodes and sibling groups', () => {
    expect(planBranchDeletion(branchTree(), 'live-only')).toEqual({
      rangeIds: [],
      awaitingInputOnly: false,
      reason: 'not-persisted'
    })
  })

  it('deletes an empty reservation alone even on the only path', () => {
    const tree: TreeResponse = {
      rootId: 'root',
      activeNodeId: 'empty',
      siblingsGroups: [],
      nodes: [node('anchor', 'root', { hasChildren: true }), node('empty', 'anchor', { isAwaitingInput: true })]
    }
    expect(planBranchDeletion(tree, 'empty')).toEqual({ rangeIds: ['empty'], awaitingInputOnly: true })
  })

  it('rejects a pending ancestor in the range despite selecting a completed leaf', () => {
    const tree = branchTree()
    tree.nodes.find((row) => row.id === 'A')!.status = 'pending'
    expect(planBranchDeletion(tree, 'L')).toEqual({ rangeIds: [], awaitingInputOnly: false, reason: 'pending' })
  })

  it('counts grouped regenerated alternatives as children and plans only their own suffix', () => {
    const tree = branchTree()
    tree.siblingsGroups = [
      {
        parentId: 'A',
        siblingsGroupId: 1,
        nodes: [node('regenerated', 'A', { role: 'assistant', hasChildren: true })].map((row) =>
          omit(row, ['parentId'])
        )
      }
    ]
    tree.nodes.push(node('regenerated-leaf', 'regenerated'))
    expect(planBranchDeletion(tree, 'regenerated')).toEqual({
      rangeIds: ['regenerated-leaf', 'regenerated'],
      awaitingInputOnly: false
    })
    expect(planBranchDeletion(tree, 'L')).toEqual({ rangeIds: ['L', 'B'], awaitingInputOnly: false })
  })

  it.each(['first', 'second'])('allows the %s first-turn alternative under the virtual root', (id) => {
    const tree: TreeResponse = {
      rootId: 'root',
      activeNodeId: 'first-leaf',
      nodes: [node('first-leaf', 'first'), node('second-leaf', 'second')],
      siblingsGroups: [
        {
          parentId: 'root',
          siblingsGroupId: 1,
          nodes: [node('first', 'root', { hasChildren: true }), node('second', 'root', { hasChildren: true })].map(
            (row) => omit(row, ['parentId'])
          )
        }
      ]
    }
    expect(planBranchDeletion(tree, id)).toEqual({ rangeIds: [`${id}-leaf`, id], awaitingInputOnly: false })
  })
})
