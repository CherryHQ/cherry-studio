import { graphlib, layout, type OrderConstraint } from '@dagrejs/dagre'
import { MarkerType, Position } from '@xyflow/react'

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
  width: 220,
  height: 112
} as const

const GRAPH_SPACING = {
  nodesep: 56,
  ranksep: 96,
  edgesep: 24,
  marginx: 24,
  marginy: 24
} as const

const EDGE_COLORS: Record<TopicMessageFlowEdgeState, string> = {
  active: 'var(--color-success)',
  default: 'var(--color-border)',
  inactive: 'var(--color-gray-400)',
  sibling: 'var(--color-border)'
}

export function layoutTopicMessageFlowGraph(graph: TopicMessageFlowGraph): TopicMessageFlowLayout {
  const draftNodeIds = new Set(graph.nodes.filter((node) => node.data.isInputDraft).map((node) => node.id))
  const layoutInputNodes = graph.nodes.filter((node) => !draftNodeIds.has(node.id))
  const depthById = getDepthById({ ...graph, nodes: layoutInputNodes })
  const orderedNodes = [...layoutInputNodes].sort((a, b) => compareGraphNodes(a, b, depthById))
  const orderConstraints = buildSiblingOrderConstraints(orderedNodes)
  const nodeOrder = new Map(orderedNodes.map((node, index) => [node.id, index]))
  const visibleEdges = getVisibleEdges({ ...graph, nodes: orderedNodes }).sort((a, b) =>
    compareGraphEdges(a, b, nodeOrder)
  )
  const draftEdges = getVisibleEdges(graph).filter(
    (edge) => draftNodeIds.has(edge.source) || draftNodeIds.has(edge.target)
  )
  if (orderedNodes.length === 0 && draftNodeIds.size === 0) {
    return {
      nodes: [],
      edges: [],
      activeNodeId: graph.activeNodeId,
      stats: graph.stats
    }
  }

  const dagreGraph = new graphlib.Graph()
    .setGraph({
      rankdir: 'TB',
      ...GRAPH_SPACING
    })
    .setDefaultEdgeLabel(() => ({}))

  for (const node of orderedNodes) {
    dagreGraph.setNode(node.id, { ...TOPIC_MESSAGE_FLOW_NODE_SIZE })
  }

  for (const edge of visibleEdges) {
    dagreGraph.setEdge(edge.source, edge.target)
  }

  layout(dagreGraph, { constraints: orderConstraints })

  const layoutNodes = orderedNodes.map((node): TopicMessageFlowNodeModel => {
    const positioned = dagreGraph.node(node.id)

    return toReactFlowNode(node, {
      x: positioned.x - TOPIC_MESSAGE_FLOW_NODE_SIZE.width / 2,
      y: positioned.y - TOPIC_MESSAGE_FLOW_NODE_SIZE.height / 2
    })
  })
  const positionedLayoutNodes = new Map(layoutNodes.map((node) => [node.id, node]))
  const draftNodes = graph.nodes
    .filter((node) => draftNodeIds.has(node.id))
    .map((node, index) => toReactFlowNode(node, getDraftNodePosition(node, graph.nodes, positionedLayoutNodes, index)))

  return {
    nodes: [...layoutNodes, ...draftNodes],
    edges: [...visibleEdges, ...draftEdges].map(toReactFlowEdge),
    activeNodeId: graph.activeNodeId,
    stats: graph.stats
  }
}

function toReactFlowNode(
  node: TopicMessageFlowGraph['nodes'][number],
  position: TopicMessageFlowNodeModel['position']
): TopicMessageFlowNodeModel {
  return {
    id: node.id,
    type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
    position,
    data: { ...node.data },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    draggable: false,
    connectable: false,
    selectable: true,
    width: TOPIC_MESSAGE_FLOW_NODE_SIZE.width,
    height: TOPIC_MESSAGE_FLOW_NODE_SIZE.height,
    initialWidth: TOPIC_MESSAGE_FLOW_NODE_SIZE.width,
    initialHeight: TOPIC_MESSAGE_FLOW_NODE_SIZE.height,
    style: {
      width: TOPIC_MESSAGE_FLOW_NODE_SIZE.width,
      height: TOPIC_MESSAGE_FLOW_NODE_SIZE.height
    }
  }
}

function getDraftNodePosition(
  node: TopicMessageFlowGraph['nodes'][number],
  graphNodes: TopicMessageFlowGraph['nodes'],
  positionedLayoutNodes: Map<string, TopicMessageFlowNodeModel>,
  draftIndex: number
): TopicMessageFlowNodeModel['position'] {
  const parentNode = node.parentId ? positionedLayoutNodes.get(node.parentId) : undefined
  const siblingPositions = graphNodes
    .filter((candidate) => candidate.parentId === node.parentId && !candidate.data.isInputDraft)
    .flatMap((candidate) => {
      const positioned = positionedLayoutNodes.get(candidate.id)
      return positioned ? [positioned.position] : []
    })

  if (parentNode) {
    const rightMostSiblingX =
      siblingPositions.length > 0 ? Math.max(...siblingPositions.map((position) => position.x)) : parentNode.position.x
    const siblingY =
      siblingPositions[0]?.y ?? parentNode.position.y + TOPIC_MESSAGE_FLOW_NODE_SIZE.height + GRAPH_SPACING.ranksep

    return {
      x:
        rightMostSiblingX +
        (siblingPositions.length > 0 ? TOPIC_MESSAGE_FLOW_NODE_SIZE.width + GRAPH_SPACING.nodesep : 0) +
        draftIndex * (TOPIC_MESSAGE_FLOW_NODE_SIZE.width + GRAPH_SPACING.nodesep),
      y: siblingY
    }
  }

  const positionedNodes = [...positionedLayoutNodes.values()]
  const rightMostX =
    positionedNodes.length > 0 ? Math.max(...positionedNodes.map((positioned) => positioned.position.x)) : 0

  return {
    x: rightMostX + draftIndex * (TOPIC_MESSAGE_FLOW_NODE_SIZE.width + GRAPH_SPACING.nodesep),
    y: GRAPH_SPACING.marginy
  }
}

function toReactFlowEdge(edge: TopicMessageFlowGraphEdge): TopicMessageFlowEdgeModel {
  const state = getEdgeState(edge)
  const color = EDGE_COLORS[state]

  return {
    id: edge.id,
    type: 'smoothstep',
    source: edge.source,
    target: edge.target,
    data: {
      ...edge.data,
      state
    },
    animated: state === 'active',
    selectable: false,
    interactionWidth: state === 'active' ? 20 : 12,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
      width: 16,
      height: 16
    },
    style: {
      stroke: color,
      strokeWidth: state === 'active' ? 2.25 : 1.5,
      strokeDasharray: state === 'active' || state === 'sibling' || state === 'inactive' ? '4 4' : undefined,
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
