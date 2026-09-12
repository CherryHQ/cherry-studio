import { graphlib, layout, type OrderConstraint } from '@dagrejs/dagre'
import { Position } from '@xyflow/react'

import type {
  TopicMessageFlowEdgeModel,
  TopicMessageFlowEdgeState,
  TopicMessageFlowGraph,
  TopicMessageFlowGraphEdge,
  TopicMessageFlowLayout,
  TopicMessageFlowNodeModel
} from './types'
import { TOPIC_MESSAGE_FLOW_NODE_TYPE } from './types'

export const TOPIC_MESSAGE_FLOW_NODE_SIZE = {
  width: 440,
  height: 280
} as const

export const TOPIC_MESSAGE_FLOW_INACTIVE_EDGE_COLOR = 'var(--border-strong)'

export interface TopicMessageFlowNodeSize {
  width: number
  height: number
}

export function getTopicMessageFlowNodeSize(node: TopicMessageFlowGraph['nodes'][number]): TopicMessageFlowNodeSize {
  if (node.data.isAwaitingInput || node.data.isContextBoundary) return { width: 300, height: 112 }
  if (node.data.role === 'user') return { width: 320, height: 160 }
  return TOPIC_MESSAGE_FLOW_NODE_SIZE
}

const GRAPH_SPACING = {
  nodesep: 56,
  ranksep: 96,
  edgesep: 24,
  marginx: 24,
  marginy: 24
} as const

const EDGE_COLORS: Record<TopicMessageFlowEdgeState, string> = {
  active: 'var(--primary)',
  default: 'var(--border-strong)',
  inactive: TOPIC_MESSAGE_FLOW_INACTIVE_EDGE_COLOR,
  sibling: 'var(--border-strong)'
}

export function layoutTopicMessageFlowGraph(
  graph: TopicMessageFlowGraph,
  measuredSizes: ReadonlyMap<string, TopicMessageFlowNodeSize> = new Map()
): TopicMessageFlowLayout {
  const depthById = getDepthById(graph)
  const orderedNodes = [...graph.nodes].sort((a, b) => compareGraphNodes(a, b, depthById))
  const orderConstraints = buildSiblingOrderConstraints(orderedNodes)
  const nodeOrder = new Map(orderedNodes.map((node, index) => [node.id, index]))
  const visibleEdges = getVisibleEdges({ ...graph, nodes: orderedNodes }).sort((a, b) =>
    compareGraphEdges(a, b, nodeOrder)
  )
  if (orderedNodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      activeNodeId: graph.activeNodeId,
      stats: graph.stats
    }
  }

  const dagreGraph = new graphlib.Graph()
    .setGraph({
      rankdir: 'LR',
      ...GRAPH_SPACING
    })
    .setDefaultEdgeLabel(() => ({}))

  for (const node of orderedNodes) {
    dagreGraph.setNode(node.id, { ...(measuredSizes.get(node.id) ?? getTopicMessageFlowNodeSize(node)) })
  }

  for (const edge of visibleEdges) {
    dagreGraph.setEdge(edge.source, edge.target)
  }

  layout(dagreGraph, { constraints: orderConstraints })

  const nodes = orderedNodes.map((node): TopicMessageFlowNodeModel => {
    const positioned = dagreGraph.node(node.id)

    const size = measuredSizes.get(node.id) ?? getTopicMessageFlowNodeSize(node)
    return toReactFlowNode(node, { x: positioned.x - size.width / 2, y: positioned.y - size.height / 2 }, size)
  })

  const root = nodes[0]
  if (root) {
    const offset = { x: root.position.x - GRAPH_SPACING.marginx, y: root.position.y - GRAPH_SPACING.marginy }
    for (const node of nodes) {
      node.position = { x: node.position.x - offset.x, y: node.position.y - offset.y }
    }
  }

  return {
    nodes,
    edges: visibleEdges.map(toReactFlowEdge),
    activeNodeId: graph.activeNodeId,
    stats: graph.stats
  }
}

function toReactFlowNode(
  node: TopicMessageFlowGraph['nodes'][number],
  position: TopicMessageFlowNodeModel['position'],
  size: TopicMessageFlowNodeSize
): TopicMessageFlowNodeModel {
  return {
    id: node.id,
    type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
    position,
    data: { ...node.data },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: false,
    connectable: false,
    selectable: true,
    width: size.width,
    measured: size,
    style: {
      width: size.width
    }
  }
}

function toReactFlowEdge(edge: TopicMessageFlowGraphEdge): TopicMessageFlowEdgeModel {
  const state = getEdgeState(edge)
  const color = EDGE_COLORS[state]

  return {
    id: edge.id,
    type: 'default',
    source: edge.source,
    target: edge.target,
    data: {
      ...edge.data,
      state
    },
    animated: false,
    selectable: false,
    interactionWidth: state === 'active' ? 20 : 12,
    style: {
      stroke: color,
      strokeWidth: state === 'active' ? 2.25 : 1.5,
      opacity: 1
    }
  }
}

function getDepthById(graph: TopicMessageFlowGraph): Map<string, number> {
  const parentById = new Map(graph.nodes.map((node) => [node.id, node.parentId]))
  const depthById = new Map<string, number>()

  const getDepth = (id: string): number => {
    if (depthById.has(id)) return depthById.get(id)!

    const parentId = parentById.get(id)
    if (!parentId || !parentById.has(parentId)) {
      depthById.set(id, 0)
      return 0
    }

    const depth = getDepth(parentId) + 1
    depthById.set(id, depth)
    return depth
  }

  for (const node of graph.nodes) {
    getDepth(node.id)
  }

  return depthById
}

function compareGraphNodes(
  a: TopicMessageFlowGraph['nodes'][number],
  b: TopicMessageFlowGraph['nodes'][number],
  depthById: Map<string, number>
) {
  const depth = (depthById.get(a.id) ?? 0) - (depthById.get(b.id) ?? 0)
  if (depth !== 0) return depth

  const createdAt = Date.parse(a.data.createdAt) - Date.parse(b.data.createdAt)
  if (createdAt !== 0) return createdAt

  return a.id.localeCompare(b.id)
}

function buildSiblingOrderConstraints(orderedNodes: TopicMessageFlowGraph['nodes']): OrderConstraint[] {
  const constraints: OrderConstraint[] = []
  const nodesByParent = new Map<string, TopicMessageFlowGraph['nodes']>()

  for (const node of orderedNodes) {
    const parentKey = node.parentId ?? '__root__'
    const siblings = nodesByParent.get(parentKey)
    if (siblings) {
      siblings.push(node)
    } else {
      nodesByParent.set(parentKey, [node])
    }
  }

  for (const siblings of nodesByParent.values()) {
    for (let i = 1; i < siblings.length; i++) {
      constraints.push({ left: siblings[i - 1].id, right: siblings[i].id })
    }
  }

  return constraints
}

function compareGraphEdges(a: TopicMessageFlowGraphEdge, b: TopicMessageFlowGraphEdge, nodeOrder: Map<string, number>) {
  const source = (nodeOrder.get(a.source) ?? 0) - (nodeOrder.get(b.source) ?? 0)
  if (source !== 0) return source

  const target = (nodeOrder.get(a.target) ?? 0) - (nodeOrder.get(b.target) ?? 0)
  if (target !== 0) return target

  return a.id.localeCompare(b.id)
}

function getVisibleEdges(graph: TopicMessageFlowGraph): TopicMessageFlowGraphEdge[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id))

  return graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
}

function getEdgeState(edge: TopicMessageFlowGraphEdge): TopicMessageFlowEdgeState {
  if (edge.data.isActivePath) return 'active'
  if (edge.data.isInactiveBranch) return 'inactive'
  if (edge.data.isSiblingBranch) return 'sibling'
  return 'default'
}
