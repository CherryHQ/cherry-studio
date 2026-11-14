import { describe, expect, it } from 'vitest'

import { type TreeNode, TREE_OFF_PATH_DEPTH_LIMIT } from '@shared/data/types/message'

import { buildTopicMessageFlowGraph } from '../topicMessageFlowGraph'
import { layoutTopicMessageFlowGraph } from '../topicMessageFlowLayout'
import type {
  TopicMessageFlowEdgeModel,
  TopicMessageFlowGraph,
  TopicMessageFlowGraphEdge,
  TopicMessageFlowGraphNode,
  TopicMessageFlowNodeModel
} from '../types'

const createdAt = '2026-05-22T00:00:00.000Z'

function createNode(
  id: string,
  parentId: string | null,
  options: Partial<TopicMessageFlowGraphNode['data']> = {}
): TopicMessageFlowGraphNode {
  return {
    id,
    parentId,
    data: {
      messageId: id,
      role: 'assistant',
      status: 'success',
      preview: id,
      createdAt,
      isActive: false,
      isOnActivePath: false,
      isInactiveBranch: true,
      ...options
    }
  }
}

function createEdge(
  source: string,
  target: string,
  data: Partial<TopicMessageFlowGraphEdge['data']> = {}
): TopicMessageFlowGraphEdge {
  return {
    id: `edge:${source}:${target}`,
    source,
    target,
    data: {
      isActivePath: false,
      isInactiveBranch: false,
      isSiblingBranch: false,
      ...data
    }
  }
}

function createGraph(overrides: Partial<TopicMessageFlowGraph> = {}): TopicMessageFlowGraph {
  return {
    nodes: [],
    edges: [],
    activeNodeId: null,
    stats: {
      nodeCount: 0,
      branchCount: 0,
      activePathLength: 0
    },
    ...overrides
  }
}

function getNode(nodes: TopicMessageFlowNodeModel[], id: string): TopicMessageFlowNodeModel {
  const node = nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`Missing node ${id}`)
  return node
}

function getEdge(edges: TopicMessageFlowEdgeModel[], source: string, target: string): TopicMessageFlowEdgeModel {
  const edge = edges.find((candidate) => candidate.source === source && candidate.target === target)
  if (!edge) throw new Error(`Missing edge ${source}->${target}`)
  return edge
}

describe('topicMessageFlowLayout', () => {
  it('lays out the deepest off-path branch the tree endpoint returns', () => {
    const treeNode = (id: string, parentId: string, role: TreeNode['role']): TreeNode => ({
      id,
      parentId,
      role,
      preview: id,
      status: 'success',
      createdAt,
      hasChildren: false
    })
    const offPath = Array.from({ length: TREE_OFF_PATH_DEPTH_LIMIT - 1 }, (_, i) =>
      treeNode(`x${i}`, i === 0 ? 'u0' : `x${i - 1}`, i % 2 === 0 ? 'assistant' : 'user')
    )
    const graph = buildTopicMessageFlowGraph({
      nodes: [treeNode('u0', 'vroot', 'user'), treeNode('a0', 'u0', 'assistant'), ...offPath],
      siblingsGroups: [],
      activeNodeId: 'a0',
      rootId: 'vroot'
    })

    const layout = layoutTopicMessageFlowGraph(graph)

    expect(layout.nodes).toHaveLength(TREE_OFF_PATH_DEPTH_LIMIT + 1)
    expect(getNode(layout.nodes, 'x0').position.y).toBeLessThan(
      getNode(layout.nodes, `x${TREE_OFF_PATH_DEPTH_LIMIT - 2}`).position.y
    )
  })

  it('returns an empty React Flow layout for an empty graph', () => {
    const graph = createGraph()

    expect(layoutTopicMessageFlowGraph(graph)).toEqual({
      nodes: [],
      edges: [],
      activeNodeId: null,
      stats: graph.stats
    })
  })

  it('preserves node data and marks active, sibling, and inactive edge styles', () => {
    const graph = createGraph({
      nodes: [
        createNode('root', null, { role: 'user', isInactiveBranch: false, isOnActivePath: true }),
        createNode('answer-active', 'root', {
          isActive: true,
          isInactiveBranch: false,
          isOnActivePath: true,
          siblingsGroupId: 7
        }),
        createNode('answer-sibling', 'root', {
          isInactiveBranch: false,
          isOnActivePath: false,
          siblingsGroupId: 7
        }),
        createNode('answer-inactive', 'root')
      ],
      edges: [
        createEdge('root', 'answer-active', { isActivePath: true }),
        createEdge('root', 'answer-sibling', { isSiblingBranch: true }),
        createEdge('root', 'answer-inactive', { isInactiveBranch: true })
      ],
      activeNodeId: 'answer-active',
      stats: {
        nodeCount: 4,
        branchCount: 1,
        activePathLength: 2
      }
    })

    const layout = layoutTopicMessageFlowGraph(graph)
    const activeNode = getNode(layout.nodes, 'answer-active')

    expect(activeNode.data.messageId).toBe('answer-active')
    expect(activeNode.data.siblingsGroupId).toBe(7)

    const activeEdge = getEdge(layout.edges, 'root', 'answer-active')
    const siblingEdge = getEdge(layout.edges, 'root', 'answer-sibling')
    const inactiveEdge = getEdge(layout.edges, 'root', 'answer-inactive')

    expect(activeEdge.data?.state).toBe('active')

    expect(siblingEdge.data?.state).toBe('sibling')

    expect(inactiveEdge.data?.state).toBe('inactive')
  })

  it('skips graph edges when either endpoint is missing', () => {
    const layout = layoutTopicMessageFlowGraph(
      createGraph({
        nodes: [createNode('orphan', 'missing-parent')],
        edges: [createEdge('missing-parent', 'orphan'), createEdge('orphan', 'missing-child')],
        activeNodeId: 'orphan'
      })
    )

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toEqual([])
  })

  it('keeps node positions stable when only the active branch changes', () => {
    const nodes = [
      createNode('root', null, {
        createdAt: '2026-05-22T14:16:00.000Z',
        role: 'user',
        isInactiveBranch: false
      }),
      createNode('assistant-root', 'root', {
        createdAt: '2026-05-22T14:16:01.000Z',
        isInactiveBranch: false
      }),
      createNode('user-web', 'assistant-root', {
        createdAt: '2026-05-22T14:17:00.000Z',
        role: 'user',
        isInactiveBranch: false
      }),
      createNode('assistant-web', 'user-web', {
        createdAt: '2026-05-22T14:17:01.000Z',
        isInactiveBranch: false
      }),
      createNode('user-scenes', 'assistant-root', {
        createdAt: '2026-05-22T14:20:00.000Z',
        role: 'user'
      }),
      createNode('assistant-scenes', 'user-scenes', {
        createdAt: '2026-05-22T14:20:01.000Z'
      })
    ]
    const edges = [
      createEdge('root', 'assistant-root', { isActivePath: true }),
      createEdge('assistant-root', 'user-web', { isActivePath: true }),
      createEdge('user-web', 'assistant-web', { isActivePath: true }),
      createEdge('assistant-root', 'user-scenes', { isInactiveBranch: true }),
      createEdge('user-scenes', 'assistant-scenes', { isInactiveBranch: true })
    ]

    const activeWebLayout = layoutTopicMessageFlowGraph(
      createGraph({
        nodes,
        edges,
        activeNodeId: 'assistant-web'
      })
    )
    const activeScenesLayout = layoutTopicMessageFlowGraph(
      createGraph({
        nodes: nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isActive: node.id === 'assistant-scenes',
            isInactiveBranch: node.id === 'user-web' || node.id === 'assistant-web',
            isOnActivePath: ['root', 'assistant-root', 'user-scenes', 'assistant-scenes'].includes(node.id)
          }
        })),
        edges: [
          createEdge('root', 'assistant-root', { isActivePath: true }),
          createEdge('assistant-root', 'user-web', { isInactiveBranch: true }),
          createEdge('user-web', 'assistant-web', { isInactiveBranch: true }),
          createEdge('assistant-root', 'user-scenes', { isActivePath: true }),
          createEdge('user-scenes', 'assistant-scenes', { isActivePath: true })
        ],
        activeNodeId: 'assistant-scenes'
      })
    )

    const positions = new Map(activeWebLayout.nodes.map((node) => [node.id, node.position]))
    for (const node of activeScenesLayout.nodes) {
      expect(node.position).toEqual(positions.get(node.id))
    }
  })
})
