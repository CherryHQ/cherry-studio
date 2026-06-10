import type { MessageRole, MessageStatus } from '@shared/data/types/message'

export const TOPIC_MESSAGE_FLOW_NODE_TYPE = 'topicMessage'

export type TopicMessageFlowEdgeState = 'active' | 'default' | 'inactive' | 'sibling'

export interface TopicMessageFlowNodeData extends Record<string, unknown> {
  messageId: string
  role: MessageRole
  status: MessageStatus
  preview: string
  modelId?: string | null
  createdAt: string
  isActive: boolean
  isOnActivePath: boolean
  isInactiveBranch: boolean
  hasAssistantDescendant?: boolean
  isInputDraft?: boolean
  siblingsGroupId?: number
}

export interface TopicMessageFlowEdgeData extends Record<string, unknown> {
  isActivePath: boolean
  isSiblingBranch: boolean
  isInactiveBranch: boolean
  state?: TopicMessageFlowEdgeState
}

export interface TopicMessageFlowGraphNode {
  id: string
  parentId: string | null
  data: TopicMessageFlowNodeData
}

export interface TopicMessageFlowGraphEdge {
  id: string
  source: string
  target: string
  data: TopicMessageFlowEdgeData
}

export interface TopicMessageFlowStats {
  nodeCount: number
  branchCount: number
  activePathLength: number
}

export interface TopicMessageFlowGraph {
  nodes: TopicMessageFlowGraphNode[]
  edges: TopicMessageFlowGraphEdge[]
  activeNodeId: string | null
  stats: TopicMessageFlowStats
}
