import { describe, expect, it } from 'vitest'

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
  it('returns an empty React Flow layout for an empty graph', () => {
    const graph = createGraph()

    expect(layoutTopicMessageFlowGraph(graph)).toEqual({
      nodes: [],
      edges: [],
      activeNodeId: null,
      stats: graph.stats
    })
  })

  it('places responses to the right of their prompts without fixing their height', () => {
    const graph = createGraph({
      nodes: [
        createNode('root', null, { role: 'user', isInactiveBranch: false, isOnActivePath: true }),
        createNode('assistant-1', 'root', {
          isActive: true,
          isInactiveBranch: false,
          isOnActivePath: true
        })
      ],
      edges: [createEdge('root', 'assistant-1', { isActivePath: true })],
      activeNodeId: 'assistant-1',
      stats: {
        nodeCount: 2,
        branchCount: 0,
        activePathLength: 2
      }
    })

    const layout = layoutTopicMessageFlowGraph(graph)
    const root = getNode(layout.nodes, 'root')
    const assistant = getNode(layout.nodes, 'assistant-1')

    expect(root.position.x + root.width!).toBeLessThan(assistant.position.x)
    expect(root.sourcePosition).toBe('right')
    expect(assistant.targetPosition).toBe('left')
    expect(root.height).toBeUndefined()
    expect(root.style?.height).toBeUndefined()
    expect(assistant.style?.height).toBeUndefined()
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
    expect(getNode(layout.nodes, 'answer-sibling').position.x).toBe(activeNode.position.x)

    const activeEdge = getEdge(layout.edges, 'root', 'answer-active')
    const siblingEdge = getEdge(layout.edges, 'root', 'answer-sibling')
    const inactiveEdge = getEdge(layout.edges, 'root', 'answer-inactive')

    expect(activeEdge.data?.state).toBe('active')
    expect(activeEdge.animated).toBe(false)
    expect(activeEdge.style?.strokeDasharray).toBeUndefined()

    expect(siblingEdge.data?.state).toBe('sibling')
    expect(siblingEdge.animated).toBe(false)
    expect(siblingEdge.style?.strokeDasharray).toBeUndefined()

    expect(inactiveEdge.data?.state).toBe('inactive')
    expect(activeEdge.style?.stroke).toBe('var(--primary)')
    expect(inactiveEdge.style?.stroke).toBe('var(--border-strong)')
    expect(inactiveEdge.style?.opacity).toBe(1)
  })

  it('orders parallel replies from top to bottom by message creation time', () => {
    const graph = createGraph({
      nodes: [
        createNode('root', null, {
          createdAt: '2026-05-22T14:16:00.000Z',
          role: 'user',
          isInactiveBranch: false
        }),
        createNode('model-a', 'root', {
          createdAt: '2026-05-22T14:16:01.000Z',
          siblingsGroupId: 7
        }),
        createNode('model-b', 'root', {
          createdAt: '2026-05-22T14:16:02.000Z',
          siblingsGroupId: 7
        }),
        createNode('model-c', 'root', {
          createdAt: '2026-05-22T14:16:03.000Z',
          siblingsGroupId: 7
        })
      ],
      edges: [
        createEdge('root', 'model-a', { isSiblingBranch: true }),
        createEdge('root', 'model-b', { isSiblingBranch: true }),
        createEdge('root', 'model-c', { isSiblingBranch: true })
      ],
      activeNodeId: 'model-c'
    })

    const layout = layoutTopicMessageFlowGraph(graph)

    expect(getNode(layout.nodes, 'model-a').position.y).toBeLessThan(getNode(layout.nodes, 'model-b').position.y)
    expect(getNode(layout.nodes, 'model-b').position.y).toBeLessThan(getNode(layout.nodes, 'model-c').position.y)
  })

  it('keeps long sibling responses apart while holding their first message in place', () => {
    const graph = createGraph({
      nodes: [createNode('topic', null, { role: 'user' }), createNode('short', 'topic'), createNode('long', 'topic')],
      edges: [createEdge('topic', 'short'), createEdge('topic', 'long')]
    })
    const initial = layoutTopicMessageFlowGraph(graph)
    const resized = layoutTopicMessageFlowGraph(
      graph,
      new Map([
        ['short', { width: 440, height: 160 }],
        ['long', { width: 440, height: 1200 }]
      ])
    )
    const siblings = resized.nodes.filter((node) => node.id !== 'topic').sort((a, b) => a.position.y - b.position.y)
    expect(siblings[0].position.y + siblings[0].measured!.height!).toBeLessThan(siblings[1].position.y)
    expect(getNode(resized.nodes, 'topic').position).toEqual(getNode(initial.nodes, 'topic').position)
  })

  it('keeps edges without active path state visually neutral', () => {
    const layout = layoutTopicMessageFlowGraph(
      createGraph({
        nodes: [createNode('root', null), createNode('child', 'root')],
        edges: [createEdge('root', 'child')]
      })
    )

    const edge = getEdge(layout.edges, 'root', 'child')

    expect(edge.data?.state).toBe('default')
    expect(edge.style?.strokeDasharray).toBeUndefined()
    expect(edge.style?.opacity).toBe(1)
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
