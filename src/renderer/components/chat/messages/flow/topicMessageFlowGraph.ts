import type { TreeNode, TreeResponse } from '@shared/data/types/message'

import type { TopicMessageFlowGraph, TopicMessageFlowNodeData } from './types'

type GraphInputNode = TreeNode & {
  parentId: string | null
  siblingsGroupId?: number
  isSiblingBranch: boolean
}

export function buildTopicMessageFlowGraph(tree: TreeResponse): TopicMessageFlowGraph {
  const graphInputNodes = flattenTreeNodes(tree)
  const parentById = new Map(graphInputNodes.map((node) => [node.id, node.parentId]))
  const activePath = collectActivePath(tree.activeNodeId, parentById)
  const hasActivePath = activePath.size > 0
  const branchCount = countBranchPaths(graphInputNodes)

  const nodes = graphInputNodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    data: toNodeData(node, tree.activeNodeId, activePath, hasActivePath)
  }))

  const edges = graphInputNodes.flatMap((node) => {
    if (!node.parentId) {
      return []
    }

    const isActivePath = activePath.has(node.parentId) && activePath.has(node.id)

    return [
      {
        id: `edge:${node.parentId}:${node.id}`,
        source: node.parentId,
        target: node.id,
        data: {
          isActivePath,
          isSiblingBranch: node.isSiblingBranch,
          isInactiveBranch: hasActivePath && !activePath.has(node.id)
        }
      }
    ]
  })

  return {
    nodes,
    edges,
    activeNodeId: tree.activeNodeId,
    stats: {
      nodeCount: nodes.length,
      branchCount,
      activePathLength: activePath.size
    }
  }
}

function flattenTreeNodes(tree: TreeResponse): GraphInputNode[] {
  const flattened = [
    ...tree.nodes.map((node) => ({
      ...node,
      parentId: node.parentId ?? null,
      isSiblingBranch: false
    })),
    ...tree.siblingsGroups.flatMap((group) => {
      const isSiblingBranch = group.nodes.length > 1

      return group.nodes.map((node) => ({
        ...node,
        parentId: group.parentId,
        siblingsGroupId: group.siblingsGroupId,
        isSiblingBranch
      }))
    })
  ]

  const uniqueNodes = new Map<string, GraphInputNode>()
  for (const node of flattened) {
    uniqueNodes.set(node.id, node)
  }

  return [...uniqueNodes.values()]
}

function countBranchPaths(nodes: GraphInputNode[]): number {
  if (nodes.length === 0) return 0

  const parentIds = new Set(nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])))
  const leafCount = nodes.filter((node) => !parentIds.has(node.id)).length

  return leafCount > 1 ? leafCount : 0
}

function collectActivePath(activeNodeId: string | null, parentById: Map<string, string | null>): Set<string> {
  const activePath = new Set<string>()

  if (!activeNodeId || !parentById.has(activeNodeId)) {
    return activePath
  }

  let currentId: string | null = activeNodeId

  while (currentId && parentById.has(currentId) && !activePath.has(currentId)) {
    activePath.add(currentId)
    currentId = parentById.get(currentId) ?? null
  }

  return activePath
}

function toNodeData(
  node: GraphInputNode,
  activeNodeId: string | null,
  activePath: Set<string>,
  hasActivePath: boolean
): TopicMessageFlowNodeData {
  const data: TopicMessageFlowNodeData = {
    messageId: node.id,
    role: node.role,
    status: node.status,
    preview: node.preview,
    modelId: node.modelId,
    createdAt: node.createdAt,
    isActive: node.id === activeNodeId,
    isOnActivePath: activePath.has(node.id),
    isInactiveBranch: hasActivePath && !activePath.has(node.id)
  }

  if (node.siblingsGroupId !== undefined) {
    data.siblingsGroupId = node.siblingsGroupId
  }

  return data
}
