import type { TreeNode, TreeResponse } from '@shared/data/types/message'

import type { TopicMessageFlowGraph, TopicMessageFlowNodeData } from './types'

// parentId stays nullable internally: null marks a node with no rendered parent
// (a first turn, whose real parent is the unrendered virtual root) i.e. a graph root.
type GraphInputNode = Omit<TreeNode, 'parentId'> & {
  parentId: string | null
  siblingsGroupId?: number
  isSiblingBranch: boolean
  isInputDraft?: boolean
}

export function buildTopicMessageFlowGraph(tree: TreeResponse): TopicMessageFlowGraph {
  const graphInputNodes = flattenTreeNodes(tree)
  const parentById = new Map(graphInputNodes.map((node) => [node.id, node.parentId]))
  const activePath = collectActivePath(tree.activeNodeId, parentById)
  const hasActivePath = activePath.size > 0
  const branchCount = countBranchPaths(graphInputNodes)
  const hasAssistantDescendantById = collectAssistantDescendantState(graphInputNodes)

  const nodes = graphInputNodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    data: toNodeData(node, tree.activeNodeId, activePath, hasActivePath, hasAssistantDescendantById)
  }))

  const edges = graphInputNodes.flatMap((node) => {
    // Skip the edge when the parent isn't a rendered node — e.g. the structural
    // virtual root, which first-turn messages hang off but which is never a node.
    if (!node.parentId || !parentById.has(node.parentId)) {
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
      const shouldKeepSiblingsGroupId =
        group.parentId !== null && group.nodes.length > 1 && group.nodes.every((node) => node.role === 'assistant')

      return group.nodes.map((node) => ({
        ...node,
        parentId: group.parentId,
        ...(shouldKeepSiblingsGroupId ? { siblingsGroupId: group.siblingsGroupId } : {}),
        isSiblingBranch: false
      }))
    })
  ]

  const uniqueNodes = new Map<string, GraphInputNode>()
  for (const node of flattened) {
    uniqueNodes.set(node.id, node)
  }

  const nodes = [...uniqueNodes.values()]
  const assistantBranchGroupKeys = getAssistantBranchGroupKeys(nodes)

  return nodes.map((node) => ({
    ...node,
    isSiblingBranch: isAssistantBranchNode(node, assistantBranchGroupKeys)
  }))
}

function countBranchPaths(nodes: GraphInputNode[]): number {
  if (nodes.length === 0) return 0

  const parentIds = new Set(nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])))
  const leafCount = nodes.filter((node) => !parentIds.has(node.id)).length

  return leafCount > 1 ? leafCount : 0
}

function getAssistantBranchGroupCounts(nodes: GraphInputNode[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const node of nodes) {
    const key = getAssistantBranchGroupKey(node)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return counts
}

function getAssistantBranchGroupKeys(nodes: GraphInputNode[]): Set<string> {
  const counts = getAssistantBranchGroupCounts(nodes)
  const keys = new Set<string>()

  for (const [key, count] of counts) {
    if (count > 1) keys.add(key)
  }

  return keys
}

function getAssistantBranchGroupKey(node: Pick<GraphInputNode, 'parentId' | 'role'>): string | null {
  if (node.role !== 'assistant' || !node.parentId) return null
  return `assistant:${node.parentId}`
}

function isAssistantBranchNode(node: GraphInputNode, assistantBranchGroupKeys: Set<string>): boolean {
  const key = getAssistantBranchGroupKey(node)
  return key ? assistantBranchGroupKeys.has(key) : false
}

function collectAssistantDescendantState(nodes: GraphInputNode[]): Map<string, boolean> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const childrenById = new Map<string, string[]>()

  for (const node of nodes) {
    if (!node.parentId) continue
    childrenById.set(node.parentId, [...(childrenById.get(node.parentId) ?? []), node.id])
  }

  const hasAssistantDescendantById = new Map<string, boolean>()
  const visiting = new Set<string>()

  const hasAssistantDescendant = (nodeId: string): boolean => {
    const cached = hasAssistantDescendantById.get(nodeId)
    if (cached !== undefined) return cached
    if (visiting.has(nodeId)) return false

    visiting.add(nodeId)
    const result = (childrenById.get(nodeId) ?? []).some((childId) => {
      const child = nodeById.get(childId)
      return child?.role === 'assistant' || hasAssistantDescendant(childId)
    })
    visiting.delete(nodeId)
    hasAssistantDescendantById.set(nodeId, result)
    return result
  }

  for (const node of nodes) {
    hasAssistantDescendant(node.id)
  }

  return hasAssistantDescendantById
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
  hasActivePath: boolean,
  hasAssistantDescendantById: Map<string, boolean>
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
    isInactiveBranch: hasActivePath && !activePath.has(node.id),
    hasAssistantDescendant: hasAssistantDescendantById.get(node.id) ?? false,
    ...(node.isInputDraft ? { isInputDraft: true } : {})
  }

  if (node.siblingsGroupId !== undefined) {
    data.siblingsGroupId = node.siblingsGroupId
  }

  return data
}
