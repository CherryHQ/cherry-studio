import type { Edge, Node } from '@xyflow/react'

import type { MindNode } from './meeting'

export const MEETING_MIND_MAP_NODE_TYPE = 'meetingMindMap'

const ROOT_NODE_WIDTH = 280
const CHILD_NODE_WIDTH = 250
const HORIZONTAL_RANK_GAP = 360
const VERTICAL_NODE_GAP = 28
const BRANCH_COLORS = [
  'var(--chart-2)',
  'var(--chart-1)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-3)'
] as const

export type MeetingMindMapSide = 'left' | 'right'

export interface MeetingMindMapNodeData extends Record<string, unknown> {
  branchIndex?: number
  color: string
  depth: number
  kind: 'branch' | 'node' | 'root'
  side?: MeetingMindMapSide
  subtitle?: string
  title: string
}

export interface MeetingMindMapEdgeData extends Record<string, unknown> {
  color: string
  depth: number
  side: MeetingMindMapSide
}

export type MeetingMindMapFlowNode = Node<MeetingMindMapNodeData, typeof MEETING_MIND_MAP_NODE_TYPE>
export type MeetingMindMapFlowEdge = Edge<MeetingMindMapEdgeData, 'bezier'>

export interface MeetingMindMapGraph {
  edges: MeetingMindMapFlowEdge[]
  focusNodeIds: string[]
  nodes: MeetingMindMapFlowNode[]
}

interface BranchDefinition {
  node: MindNode
  path: number[]
}

interface BranchPlacement extends BranchDefinition {
  branchIndex: number
  color: string
  side: MeetingMindMapSide
  span: number
}

interface NodeSize {
  height: number
  width: number
}

function getTextUnits(value: string): number {
  return Array.from(value).reduce((units, character) => units + ((character.codePointAt(0) ?? 0) <= 0xff ? 0.55 : 1), 0)
}

function getNodeSize(title: string, depth: number, hasSubtitle = false): NodeSize {
  const width = depth === 0 ? ROOT_NODE_WIDTH : CHILD_NODE_WIDTH
  const charactersPerLine = depth === 0 ? 19 : 20
  const lines = Math.min(4, Math.max(1, Math.ceil(getTextUnits(title) / charactersPerLine)))

  if (depth === 0) {
    return { width, height: Math.max(88, 42 + lines * 20 + (hasSubtitle ? 18 : 0)) }
  }

  return { width, height: Math.max(depth === 1 ? 76 : 64, 34 + lines * 20) }
}

function getSubtreeSpan(node: MindNode, depth: number): number {
  const ownHeight = getNodeSize(node.Title, depth).height
  if (node.Topic.length === 0) return ownHeight + VERTICAL_NODE_GAP

  const childSpan = node.Topic.reduce((total, child) => total + getSubtreeSpan(child, depth + 1), 0)
  return Math.max(ownHeight + VERTICAL_NODE_GAP, childSpan)
}

function nodeId(path: number[]): string {
  return `node-${path.join('-')}`
}

function normalizeRoot(title: string, nodes: MindNode[]) {
  const apiRoot = nodes.length === 1 && nodes[0].Topic.length > 0 ? nodes[0] : null
  if (apiRoot) {
    return {
      branches: apiRoot.Topic.map((node, index): BranchDefinition => ({ node, path: [0, index] })),
      subtitle: apiRoot.Title === title ? undefined : title,
      title: apiRoot.Title
    }
  }

  return {
    branches: nodes.map((node, index): BranchDefinition => ({ node, path: [index] })),
    subtitle: undefined,
    title
  }
}

function assignBranchSides(branches: BranchDefinition[]): BranchPlacement[] {
  let leftSpan = 0
  let rightSpan = 0

  return branches.map((branch, branchIndex) => {
    const span = getSubtreeSpan(branch.node, 1)
    const side: MeetingMindMapSide = rightSpan <= leftSpan ? 'right' : 'left'
    if (side === 'right') rightSpan += span
    else leftSpan += span

    return {
      ...branch,
      branchIndex,
      color: BRANCH_COLORS[branchIndex % BRANCH_COLORS.length],
      side,
      span
    }
  })
}

export function buildMeetingMindMapGraph(title: string, mindMapNodes: MindNode[]): MeetingMindMapGraph {
  const normalized = normalizeRoot(title, mindMapNodes)
  const rootSize = getNodeSize(normalized.title, 0, Boolean(normalized.subtitle))
  const nodes: MeetingMindMapFlowNode[] = [
    {
      id: 'root',
      type: MEETING_MIND_MAP_NODE_TYPE,
      position: { x: -rootSize.width / 2, y: -rootSize.height / 2 },
      data: {
        color: 'var(--primary)',
        depth: 0,
        kind: 'root',
        subtitle: normalized.subtitle,
        title: normalized.title
      },
      connectable: false,
      draggable: false,
      selectable: false,
      width: rootSize.width,
      height: rootSize.height,
      initialWidth: rootSize.width,
      initialHeight: rootSize.height,
      style: rootSize
    }
  ]
  const edges: MeetingMindMapFlowEdge[] = []
  const placements = assignBranchSides(normalized.branches)

  const placeNode = (
    definition: BranchDefinition,
    parentId: string,
    side: MeetingMindMapSide,
    depth: number,
    startY: number,
    span: number,
    color: string,
    branchIndex: number
  ) => {
    const id = nodeId(definition.path)
    const size = getNodeSize(definition.node.Title, depth)
    const centerX = (side === 'right' ? 1 : -1) * depth * HORIZONTAL_RANK_GAP
    const centerY = startY + span / 2

    nodes.push({
      id,
      type: MEETING_MIND_MAP_NODE_TYPE,
      position: { x: centerX - size.width / 2, y: centerY - size.height / 2 },
      data: {
        branchIndex: depth === 1 ? branchIndex : undefined,
        color,
        depth,
        kind: depth === 1 ? 'branch' : 'node',
        side,
        title: definition.node.Title
      },
      connectable: false,
      draggable: false,
      selectable: false,
      width: size.width,
      height: size.height,
      initialWidth: size.width,
      initialHeight: size.height,
      style: size
    })

    edges.push({
      id: `edge-${parentId}-${id}`,
      type: 'bezier',
      source: parentId,
      target: id,
      sourceHandle: side === 'right' ? 'right-source' : 'left-source',
      targetHandle: side === 'right' ? 'left-target' : 'right-target',
      data: { color, depth, side },
      selectable: false,
      interactionWidth: 12,
      style: {
        opacity: depth === 1 ? 0.9 : 0.68,
        stroke: color,
        strokeWidth: depth === 1 ? 2.5 : 1.75
      }
    })

    const childSpans = definition.node.Topic.map((child) => getSubtreeSpan(child, depth + 1))
    const childrenSpan = childSpans.reduce((total, childSpan) => total + childSpan, 0)
    let childStartY = startY + Math.max(0, (span - childrenSpan) / 2)

    definition.node.Topic.forEach((child, index) => {
      const childSpan = childSpans[index]
      placeNode(
        { node: child, path: [...definition.path, index] },
        id,
        side,
        depth + 1,
        childStartY,
        childSpan,
        color,
        branchIndex
      )
      childStartY += childSpan
    })
  }

  for (const side of ['left', 'right'] as const) {
    const sidePlacements = placements.filter((placement) => placement.side === side)
    const totalSpan = sidePlacements.reduce((sum, placement) => sum + placement.span, 0)
    let startY = -totalSpan / 2

    for (const placement of sidePlacements) {
      placeNode(placement, 'root', placement.side, 1, startY, placement.span, placement.color, placement.branchIndex)
      startY += placement.span
    }
  }

  return {
    nodes,
    edges,
    focusNodeIds: ['root', ...placements.map((placement) => nodeId(placement.path))]
  }
}
