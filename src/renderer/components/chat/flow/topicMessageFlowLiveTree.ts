import type {
  CherryMessagePart,
  CherryUIMessage,
  MessageStatus,
  TreeNode,
  TreeResponse
} from '@shared/data/types/message'

const LIVE_PREVIEW_LENGTH = 160

export interface TopicMessageFlowLiveNode {
  id: string
  parentId: string
  role: TreeNode['role']
  preview: string
  modelId?: string | null
  status: MessageStatus
  createdAt: string
  siblingsGroupId?: number
  isInputDraft?: boolean
}

export interface TopicMessageFlowLiveState {
  topicId: string
  activeNodeId: string | null
  nodes: TopicMessageFlowLiveNode[]
}

interface BuildTopicMessageFlowLiveStateParams {
  topicId: string
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  activeNodeId: string | null
  streamingMessageIds?: ReadonlySet<string>
}

function truncateLivePreview(text: string): string {
  return text.length > LIVE_PREVIEW_LENGTH ? `${text.substring(0, LIVE_PREVIEW_LENGTH)}...` : text
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined

  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

function getObjectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined

  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' ? (field as Record<string, unknown>) : undefined
}

function extractTopicMessageFlowLivePreview(parts: CherryMessagePart[]): string {
  for (const part of parts) {
    const data = getObjectField(part, 'data')
    const text =
      part.type === 'text'
        ? getStringField(part, 'text')
        : ['data-code', 'data-translation'].includes(part.type)
          ? getStringField(data, 'content')
          : part.type === 'data-compact'
            ? (getStringField(data, 'content') ?? getStringField(data, 'compactedContent'))
            : part.type === 'data-error'
              ? getStringField(data, 'message')
              : undefined

    const preview = text?.trim()
    if (preview) return truncateLivePreview(preview)
  }

  return ''
}

export function buildTopicMessageFlowLiveState({
  topicId,
  messages,
  partsByMessageId,
  activeNodeId,
  streamingMessageIds
}: BuildTopicMessageFlowLiveStateParams): TopicMessageFlowLiveState | null {
  const nodes = messages.flatMap((message): TopicMessageFlowLiveNode[] => {
    const metadata = message.metadata ?? {}
    // Every content / draft node has a parent (the virtual root is excluded from the
    // message list); skip a parentless row defensively. The guard narrows `parentId`
    // to a non-null `string`; it never drops a real node.
    const parentId = metadata.parentId
    if (parentId == null) return []

    const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
    const createdAt = metadata.createdAt ?? new Date().toISOString()
    const isStreamingMessage = streamingMessageIds?.has(message.id) ?? false
    const fallbackStatus = message.role === 'assistant' && parts.length === 0 ? 'pending' : 'success'

    return [
      {
        id: message.id,
        parentId,
        role: message.role === 'system' ? 'assistant' : message.role,
        preview: extractTopicMessageFlowLivePreview(parts),
        modelId: metadata.modelId ?? null,
        status: isStreamingMessage ? 'pending' : (metadata.status ?? fallbackStatus),
        createdAt,
        ...(metadata.siblingsGroupId ? { siblingsGroupId: metadata.siblingsGroupId } : {})
      }
    ]
  })

  if (nodes.length === 0) return null

  return {
    topicId,
    activeNodeId: activeNodeId ?? nodes.at(-1)?.id ?? null,
    nodes
  }
}

type TopicMessageFlowTreeNode = TreeNode & {
  isInputDraft?: boolean
}

function toTreeNode(node: TopicMessageFlowLiveNode, existing?: TreeNode): TopicMessageFlowTreeNode {
  return {
    id: node.id,
    parentId: node.parentId,
    role: node.role,
    preview: node.preview || existing?.preview || '',
    modelId: node.modelId ?? existing?.modelId ?? null,
    status: node.status,
    createdAt: node.createdAt,
    hasChildren: existing?.hasChildren ?? false,
    ...(node.isInputDraft ? { isInputDraft: true } : {})
  }
}

function compareTreeNodeOrder(a: Omit<TreeNode, 'parentId'>, b: Omit<TreeNode, 'parentId'>): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function groupKey(parentId: string | null, siblingsGroupId: number): string {
  return `${parentId ?? 'root'}:${siblingsGroupId}`
}

export function mergeTopicMessageFlowLiveTree(
  tree: TreeResponse,
  liveState: TopicMessageFlowLiveState | null | undefined
): TreeResponse {
  if (!liveState) return tree

  const regularNodes = new Map<string, TopicMessageFlowTreeNode>()
  const siblingGroups = new Map<string, TreeResponse['siblingsGroups'][number]>()
  const existingTreeNodes = new Map<string, TreeNode>()
  const groupedNodeIds = new Set<string>()

  for (const node of tree.nodes) {
    regularNodes.set(node.id, node)
    existingTreeNodes.set(node.id, node)
  }

  for (const group of tree.siblingsGroups) {
    const key = groupKey(group.parentId, group.siblingsGroupId)
    siblingGroups.set(key, {
      parentId: group.parentId,
      siblingsGroupId: group.siblingsGroupId,
      nodes: group.nodes.slice()
    })
    for (const node of group.nodes) {
      existingTreeNodes.set(node.id, { ...node, parentId: group.parentId })
      groupedNodeIds.add(node.id)
    }
  }

  for (const liveNode of liveState.nodes) {
    const existing = existingTreeNodes.get(liveNode.id)
    if (liveNode.siblingsGroupId && liveNode.siblingsGroupId !== 0) {
      regularNodes.delete(liveNode.id)
      const key = groupKey(liveNode.parentId, liveNode.siblingsGroupId)
      const group =
        siblingGroups.get(key) ??
        ({
          parentId: liveNode.parentId,
          siblingsGroupId: liveNode.siblingsGroupId,
          nodes: []
        } satisfies TreeResponse['siblingsGroups'][number])
      const nextNode = toTreeNode(liveNode, existing)
      const existingIndex = group.nodes.findIndex((node) => node.id === liveNode.id)
      group.nodes =
        existingIndex === -1
          ? [...group.nodes, nextNode].sort(compareTreeNodeOrder)
          : group.nodes.map((node, index) => (index === existingIndex ? nextNode : node))
      siblingGroups.set(key, group)
      groupedNodeIds.add(liveNode.id)
      continue
    }

    regularNodes.set(liveNode.id, toTreeNode(liveNode, existing))
  }

  const childParentIds = new Set<string>()
  for (const node of regularNodes.values()) {
    if (node.parentId) childParentIds.add(node.parentId)
  }
  for (const group of siblingGroups.values()) {
    if (group.parentId) childParentIds.add(group.parentId)
  }

  return {
    activeNodeId: liveState.activeNodeId ?? tree.activeNodeId,
    rootId: tree.rootId,
    nodes: Array.from(regularNodes.values())
      .filter((node) => !groupedNodeIds.has(node.id))
      .map((node) => ({ ...node, hasChildren: node.hasChildren || childParentIds.has(node.id) })),
    siblingsGroups: Array.from(siblingGroups.values()).map((group) => ({
      ...group,
      nodes: group.nodes
        .map((node) => ({ ...node, hasChildren: node.hasChildren || childParentIds.has(node.id) }))
        .sort(compareTreeNodeOrder)
    }))
  }
}
