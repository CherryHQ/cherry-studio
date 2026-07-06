import type { TreeNode, TreeResponse } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildTopicMessageFlowGraph } from '../topicMessageFlowGraph'

const createdAt = '2026-05-22T00:00:00.000Z'

function treeNode({ id, ...overrides }: Partial<TreeNode> & Pick<TreeNode, 'id'>): TreeNode {
  return {
    id,
    // Roots hang off the unrendered virtual root; use a non-node sentinel id so the
    // edge guard skips the edge and the node still renders as a graph root.
    parentId: 'vroot',
    role: 'user',
    preview: id,
    modelId: null,
    status: 'success',
    createdAt,
    hasChildren: false,
    ...overrides
  }
}

function siblingNode(
  overrides: Partial<Omit<TreeNode, 'parentId'>> & Pick<TreeNode, 'id'>
): Omit<TreeNode, 'parentId'> {
  const { parentId: _parentId, ...node } = treeNode(overrides)
  void _parentId

  return node
}

describe('buildTopicMessageFlowGraph', () => {
  it('builds nodes and edges for a linear tree', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'assistant-1', parentId: 'root', role: 'assistant', hasChildren: true }),
        treeNode({ id: 'user-2', parentId: 'assistant-1' })
      ],
      siblingsGroups: [],
      activeNodeId: 'user-2',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.map((node) => node.id)).toEqual(['root', 'assistant-1', 'user-2'])
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['root', 'assistant-1'],
      ['assistant-1', 'user-2']
    ])
    expect(graph.stats).toEqual({
      nodeCount: 3,
      branchCount: 0,
      activePathLength: 3
    })
    expect(graph.nodes.every((node) => node.data.isOnActivePath)).toBe(true)
    expect(graph.edges.every((edge) => edge.data.isActivePath)).toBe(true)
  })

  it('expands sibling groups into branch nodes and marks sibling edges', () => {
    const tree: TreeResponse = {
      nodes: [treeNode({ id: 'root', hasChildren: true })],
      siblingsGroups: [
        {
          parentId: 'root',
          siblingsGroupId: 7,
          nodes: [
            siblingNode({ id: 'assistant-a', role: 'assistant', modelId: 'model-a' }),
            siblingNode({ id: 'assistant-b', role: 'assistant', modelId: 'model-b' })
          ]
        }
      ],
      activeNodeId: 'assistant-b',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.map((node) => [node.id, node.parentId, node.data.siblingsGroupId])).toEqual([
      ['root', 'vroot', undefined],
      ['assistant-a', 'root', 7],
      ['assistant-b', 'root', 7]
    ])
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges.every((edge) => edge.data.isSiblingBranch)).toBe(true)
    expect(graph.stats.branchCount).toBe(2)
  })

  it('expands root sibling groups into independent root trees', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'assistant-original', parentId: 'root-original', role: 'assistant' }),
        treeNode({ id: 'assistant-edited', parentId: 'root-edited', role: 'assistant' })
      ],
      siblingsGroups: [
        {
          parentId: 'vroot',
          siblingsGroupId: 9,
          nodes: [siblingNode({ id: 'root-original' }), siblingNode({ id: 'root-edited' })]
        }
      ],
      activeNodeId: 'assistant-edited',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.map((node) => [node.id, node.parentId, node.data.siblingsGroupId])).toEqual([
      ['assistant-original', 'root-original', undefined],
      ['assistant-edited', 'root-edited', undefined],
      ['root-original', 'vroot', undefined],
      ['root-edited', 'vroot', undefined]
    ])
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['root-original', 'assistant-original'],
      ['root-edited', 'assistant-edited']
    ])
    expect(graph.nodes.find((node) => node.id === 'root-edited')?.data.isOnActivePath).toBe(true)
    expect(graph.nodes.find((node) => node.id === 'root-original')?.data.isInactiveBranch).toBe(true)
    expect(graph.stats.branchCount).toBe(2)
  })

  it('counts ungrouped same-topic root trees as separate branch paths', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root-a', hasChildren: true }),
        treeNode({ id: 'answer-a', parentId: 'root-a', role: 'assistant' }),
        treeNode({ id: 'root-b', hasChildren: true }),
        treeNode({ id: 'answer-b', parentId: 'root-b', role: 'assistant' })
      ],
      siblingsGroups: [],
      activeNodeId: 'answer-b',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.map((node) => [node.id, node.parentId])).toEqual([
      ['root-a', 'vroot'],
      ['answer-a', 'root-a'],
      ['root-b', 'vroot'],
      ['answer-b', 'root-b']
    ])
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['root-a', 'answer-a'],
      ['root-b', 'answer-b']
    ])
    expect(graph.stats.branchCount).toBe(2)
  })

  it('counts user sibling branches as branch paths without marking them as assistant branch displays', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'assistant-1', parentId: 'root', role: 'assistant', hasChildren: true }),
        treeNode({ id: 'user-web', parentId: 'assistant-1', createdAt: '2026-05-22T14:17:00.000Z', hasChildren: true }),
        treeNode({
          id: 'assistant-web',
          parentId: 'user-web',
          role: 'assistant',
          createdAt: '2026-05-22T14:17:01.000Z'
        }),
        treeNode({
          id: 'user-scenes',
          parentId: 'assistant-1',
          createdAt: '2026-05-22T14:20:00.000Z',
          hasChildren: true
        }),
        treeNode({
          id: 'assistant-scenes',
          parentId: 'user-scenes',
          role: 'assistant',
          createdAt: '2026-05-22T14:20:01.000Z'
        })
      ],
      siblingsGroups: [],
      activeNodeId: 'assistant-web',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.stats.branchCount).toBe(2)
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'root',
      'assistant-1',
      'user-web',
      'assistant-web',
      'user-scenes',
      'assistant-scenes'
    ])
    expect(graph.edges.every((edge) => !edge.data.isSiblingBranch)).toBe(true)
  })

  it('counts same-parent assistant siblings as message-list branch displays without requiring a sibling group', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'assistant-a', parentId: 'root', role: 'assistant' }),
        treeNode({ id: 'assistant-b', parentId: 'root', role: 'assistant' })
      ],
      siblingsGroups: [],
      activeNodeId: 'assistant-a',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.stats.branchCount).toBe(2)
    expect(graph.edges.every((edge) => edge.data.isSiblingBranch)).toBe(true)
  })

  it('marks the active node and its ancestors as the active path', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'assistant-1', parentId: 'root', role: 'assistant', hasChildren: true }),
        treeNode({ id: 'user-2', parentId: 'assistant-1' }),
        treeNode({ id: 'side-branch', parentId: 'root', role: 'assistant' })
      ],
      siblingsGroups: [],
      activeNodeId: 'user-2',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    const activePath = graph.nodes.filter((node) => node.data.isOnActivePath).map((node) => node.id)
    expect(activePath).toEqual(['root', 'assistant-1', 'user-2'])
    expect(graph.nodes.find((node) => node.id === 'user-2')?.data.isActive).toBe(true)
    expect(graph.stats.activePathLength).toBe(3)
  })

  it('returns an empty graph for an empty tree', () => {
    const graph = buildTopicMessageFlowGraph({
      nodes: [],
      siblingsGroups: [],
      activeNodeId: null,
      rootId: null
    })

    expect(graph).toEqual({
      nodes: [],
      edges: [],
      activeNodeId: null,
      stats: {
        nodeCount: 0,
        branchCount: 0,
        activePathLength: 0
      }
    })
  })

  it('marks nodes and edges outside the active path as inactive branches', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'active-leaf', parentId: 'root', role: 'assistant' }),
        treeNode({ id: 'inactive-leaf', parentId: 'root', role: 'assistant' })
      ],
      siblingsGroups: [],
      activeNodeId: 'active-leaf',
      rootId: null
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.find((node) => node.id === 'inactive-leaf')?.data.isInactiveBranch).toBe(true)
    expect(graph.nodes.find((node) => node.id === 'active-leaf')?.data.isInactiveBranch).toBe(false)
    expect(graph.edges.find((edge) => edge.target === 'inactive-leaf')?.data.isInactiveBranch).toBe(true)
    expect(graph.edges.find((edge) => edge.target === 'active-leaf')?.data.isInactiveBranch).toBe(false)
  })
})
