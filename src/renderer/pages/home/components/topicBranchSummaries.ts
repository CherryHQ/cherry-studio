import type { TopicBranchName, TopicBranchSummary } from '@renderer/types/topicBranch'
import type { TreeNode, TreeResponse } from '@shared/data/types/message'

type ProjectedNode = Omit<TreeNode, 'parentId'> & { parentId: string }

const compareNodes = (a: Pick<ProjectedNode, 'createdAt' | 'id'>, b: Pick<ProjectedNode, 'createdAt' | 'id'>) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

function flattenTree(tree: TreeResponse): ProjectedNode[] {
  const nodesById = new Map<string, ProjectedNode>()

  for (const node of tree.nodes) {
    nodesById.set(node.id, node)
  }
  for (const group of tree.siblingsGroups) {
    for (const node of group.nodes) {
      nodesById.set(node.id, { ...node, parentId: group.parentId })
    }
  }

  return [...nodesById.values()].sort(compareNodes)
}

function collectPath(endpoint: ProjectedNode, nodesById: Map<string, ProjectedNode>): ProjectedNode[] {
  const path: ProjectedNode[] = []
  const visited = new Set<string>()
  let current: ProjectedNode | undefined = endpoint

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.push(current)
    current = nodesById.get(current.parentId)
  }

  return path.reverse()
}

const hasMessagePreview = (node: ProjectedNode) => node.preview.trim().length > 0
const countTurns = (nodes: ProjectedNode[]) =>
  nodes.filter((node) => node.role === 'user' && node.hasContent && !node.isContextBoundary).length

function findForkIndex(
  path: ProjectedNode[],
  roots: ProjectedNode[],
  childrenByParent: Map<string, ProjectedNode[]>
): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const siblings = index === 0 ? roots : (childrenByParent.get(path[index - 1].id) ?? [])
    if (siblings.length > 1) return index
  }
  return -1
}

function deriveBranchName(path: ProjectedNode[], forkIndex: number, endpoint: ProjectedNode): TopicBranchName {
  const branchSegment = path.slice(Math.max(forkIndex, 0))
  const firstPreview = branchSegment.find(hasMessagePreview)?.preview.trim()

  if (firstPreview) return { kind: 'preview', value: firstPreview }
  if (endpoint.isAwaitingInput) return { kind: 'newBranch' }
  return { kind: 'fallback', index: 0 }
}

export function buildTopicBranchSummaries(tree: TreeResponse): TopicBranchSummary[] {
  const nodes = flattenTree(tree)
  if (nodes.length === 0) return []

  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))
  const childrenByParent = new Map<string, ProjectedNode[]>()
  for (const node of nodes) {
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(node)
    childrenByParent.set(node.parentId, children)
  }
  for (const children of childrenByParent.values()) children.sort(compareNodes)

  const roots = nodes.filter((node) => !nodesById.has(node.parentId)).sort(compareNodes)
  const leaves = nodes.filter((node) => (childrenByParent.get(node.id)?.length ?? 0) === 0)

  let mainEndpoint = roots[0]
  while (mainEndpoint) {
    const firstChild = childrenByParent.get(mainEndpoint.id)?.[0]
    if (!firstChild) break
    mainEndpoint = firstChild
  }

  const endpoints = new Map(leaves.map((node) => [node.id, node] as const))
  const activeNode = tree.activeNodeId ? nodesById.get(tree.activeNodeId) : undefined
  const activeIsNonLeaf = activeNode ? (childrenByParent.get(activeNode.id)?.length ?? 0) > 0 : false
  if (activeNode && activeIsNonLeaf) endpoints.set(activeNode.id, activeNode)

  const summaries = [...endpoints.values()].map<TopicBranchSummary>((endpoint) => {
    const path = collectPath(endpoint, nodesById)
    const isMain = endpoint.id === mainEndpoint?.id
    const isCurrentPath = activeIsNonLeaf && endpoint.id === activeNode?.id
    const forkIndex = isMain || isCurrentPath ? -1 : findForkIndex(path, roots, childrenByParent)
    const branchStart = forkIndex >= 0 ? path[forkIndex] : null

    return {
      nodeId: endpoint.id,
      name: isMain
        ? { kind: 'main' }
        : isCurrentPath
          ? { kind: 'currentPath' }
          : deriveBranchName(path, forkIndex, endpoint),
      isMain,
      isActive: endpoint.id === tree.activeNodeId,
      branchPointTurn: branchStart ? countTurns(path.slice(0, forkIndex)) : null,
      branchCreatedAt: branchStart?.createdAt ?? null,
      turnCount: countTurns(path),
      lastActivityAt: endpoint.createdAt
    }
  })

  summaries.sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1
    return b.lastActivityAt.localeCompare(a.lastActivityAt) || a.nodeId.localeCompare(b.nodeId)
  })

  let fallbackIndex = 0
  return summaries.map((summary) => {
    if (summary.name.kind !== 'fallback') return summary
    fallbackIndex += 1
    return { ...summary, name: { kind: 'fallback', index: fallbackIndex } }
  })
}
