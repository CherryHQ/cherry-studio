import type { TreeNode, TreeResponse } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildTopicBranchSummaries } from '../topicBranchSummaries'

function node(id: string, parentId: string, createdAt: string, overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    parentId,
    role: 'user',
    hasContent: true,
    preview: id,
    status: 'success',
    createdAt,
    hasChildren: false,
    ...overrides
  }
}

function siblingNode(
  id: string,
  createdAt: string,
  overrides: Partial<Omit<TreeNode, 'parentId'>> = {}
): Omit<TreeNode, 'parentId'> {
  const { parentId: _parentId, ...result } = node(id, '', createdAt, overrides)
  void _parentId
  return result
}

function tree(overrides: Partial<TreeResponse>): TreeResponse {
  return {
    activeNodeId: null,
    rootId: 'virtual-root',
    nodes: [],
    siblingsGroups: [],
    ...overrides
  }
}

describe('buildTopicBranchSummaries', () => {
  it('projects a linear conversation as one active Main branch', () => {
    const result = buildTopicBranchSummaries(
      tree({
        activeNodeId: 'answer-2',
        nodes: [
          node('user-1', 'virtual-root', '2026-01-01T00:00:00.000Z', { preview: 'Question', hasChildren: true }),
          node('answer-1', 'user-1', '2026-01-01T00:01:00.000Z', {
            role: 'assistant',
            preview: 'Answer',
            hasChildren: true
          }),
          node('user-2', 'answer-1', '2026-01-01T00:02:00.000Z', { preview: 'Follow-up', hasChildren: true }),
          node('answer-2', 'user-2', '2026-01-01T00:03:00.000Z', { role: 'assistant', preview: 'Done' })
        ]
      })
    )

    expect(result).toEqual([
      {
        nodeId: 'answer-2',
        name: { kind: 'main' },
        isMain: true,
        isActive: true,
        branchPointTurn: null,
        branchCreatedAt: null,
        turnCount: 2,
        lastActivityAt: '2026-01-01T00:03:00.000Z'
      }
    ])
  })

  it('chooses the earliest path as Main and derives nested branch metadata', () => {
    const result = buildTopicBranchSummaries(
      tree({
        activeNodeId: 'answer-latest',
        nodes: [
          node('user-1', 'virtual-root', '2026-01-01T00:00:00.000Z', { preview: 'Start', hasChildren: true }),
          node('answer-1', 'user-1', '2026-01-01T00:01:00.000Z', {
            role: 'assistant',
            preview: 'First answer',
            hasChildren: true
          }),
          node('user-main', 'answer-1', '2026-01-01T00:02:00.000Z', { preview: 'Original route' }),
          node('user-branch', 'answer-1', '2026-01-01T00:03:00.000Z', {
            preview: 'Try another model',
            hasChildren: true
          }),
          node('answer-branch', 'user-branch', '2026-01-01T00:04:00.000Z', {
            role: 'assistant',
            preview: 'Alternative',
            hasChildren: true
          }),
          node('user-nested-main', 'answer-branch', '2026-01-01T00:05:00.000Z', { preview: 'Keep going' }),
          node('user-nested-new', 'answer-branch', '2026-01-01T00:06:00.000Z', {
            preview: 'Export Markdown correctly',
            hasChildren: true
          }),
          node('answer-latest', 'user-nested-new', '2026-01-01T00:07:00.000Z', {
            role: 'assistant',
            preview: 'Latest answer'
          })
        ]
      })
    )

    expect(result.map((branch) => [branch.nodeId, branch.name, branch.isMain, branch.isActive])).toEqual([
      ['user-main', { kind: 'main' }, true, false],
      ['answer-latest', { kind: 'preview', value: 'Export Markdown correctly' }, false, true],
      ['user-nested-main', { kind: 'preview', value: 'Keep going' }, false, false]
    ])
    expect(result[1]).toMatchObject({ branchPointTurn: 2, turnCount: 3 })
    expect(result[2]).toMatchObject({ branchPointTurn: 2, turnCount: 3 })
  })

  it('flattens root sibling groups and treats a root fork as branched at start', () => {
    const result = buildTopicBranchSummaries(
      tree({
        activeNodeId: 'answer-b',
        nodes: [
          node('answer-a', 'root-a', '2026-01-01T00:02:00.000Z', { role: 'assistant' }),
          node('answer-b', 'root-b', '2026-01-01T00:04:00.000Z', { role: 'assistant' })
        ],
        siblingsGroups: [
          {
            parentId: 'virtual-root',
            siblingsGroupId: 1,
            nodes: [
              siblingNode('root-b', '2026-01-01T00:03:00.000Z', { preview: 'Second start' }),
              siblingNode('root-a', '2026-01-01T00:01:00.000Z', { preview: 'First start' })
            ]
          }
        ]
      })
    )

    expect(result.map((branch) => branch.nodeId)).toEqual(['answer-a', 'answer-b'])
    expect(result[1]).toMatchObject({
      name: { kind: 'preview', value: 'Second start' },
      branchPointTurn: 0,
      branchCreatedAt: '2026-01-01T00:03:00.000Z'
    })
  })

  it('counts attachment-only turns while keeping blank reserved and active non-leaf paths visible', () => {
    const result = buildTopicBranchSummaries(
      tree({
        activeNodeId: 'answer-1',
        nodes: [
          node('user-1', 'virtual-root', '2026-01-01T00:00:00.000Z', {
            preview: '',
            hasContent: true,
            hasChildren: true
          }),
          node('answer-1', 'user-1', '2026-01-01T00:01:00.000Z', {
            role: 'assistant',
            preview: 'Answer',
            hasChildren: true
          }),
          node('user-main', 'answer-1', '2026-01-01T00:02:00.000Z', { preview: 'Continue' }),
          node('user-empty', 'answer-1', '2026-01-01T00:03:00.000Z', {
            preview: '   ',
            hasContent: false,
            isAwaitingInput: true
          })
        ]
      })
    )

    expect(result.map((branch) => [branch.nodeId, branch.name, branch.turnCount])).toEqual([
      ['user-main', { kind: 'main' }, 2],
      ['user-empty', { kind: 'newBranch' }, 1],
      ['answer-1', { kind: 'currentPath' }, 1]
    ])
  })

  it('uses stable ids to break equal creation-time ties and numbers unnamed branches after sorting', () => {
    const sameTime = '2026-01-01T00:00:00.000Z'
    const result = buildTopicBranchSummaries(
      tree({
        nodes: [
          node('root-b', 'virtual-root', sameTime, { preview: '', isAwaitingInput: false }),
          node('root-a', 'virtual-root', sameTime, { preview: '' })
        ]
      })
    )

    expect(result.map((branch) => [branch.nodeId, branch.name])).toEqual([
      ['root-a', { kind: 'main' }],
      ['root-b', { kind: 'fallback', index: 1 }]
    ])
  })
})
