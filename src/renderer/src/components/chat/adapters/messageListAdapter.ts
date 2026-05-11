import type { Message } from '@renderer/types/newMessage'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agents'
import type { AgentPersistedMessage, AgentPersistedMessageContent } from '@shared/data/types/agentMessage'
import type { CherryMessagePart, MessageStatus } from '@shared/data/types/message'

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type ChatMessageStatus = MessageStatus | 'processing' | 'searching' | 'success' | 'pending' | 'error' | 'paused'

export interface ChatMessageItem {
  id: string
  role: ChatMessageRole
  status: ChatMessageStatus
  createdAt: string
  updatedAt?: string
  modelId?: string
  parts: readonly CherryMessagePart[]
  blocks: readonly string[]
}

function toMessageRole(role: string | undefined): ChatMessageRole {
  switch (role) {
    case 'assistant':
    case 'system':
    case 'tool':
    case 'user':
      return role
    default:
      return 'assistant'
  }
}

function toMessageStatus(status: string | undefined, role: ChatMessageRole): ChatMessageStatus {
  if (status === 'processing' || status === 'searching' || status === 'pending' || status === 'error') return status
  if (status === 'paused' || status === 'success') return status
  return role === 'user' ? 'success' : 'pending'
}

function readPersistedMessage(content: unknown): AgentPersistedMessageContent | undefined {
  if (!content || typeof content !== 'object') return undefined

  const maybePersisted = content as Partial<AgentPersistedMessage>
  if (maybePersisted.message && typeof maybePersisted.message === 'object') return maybePersisted.message

  return undefined
}

export function adaptRendererMessage(message: Message): ChatMessageItem {
  return {
    id: message.id,
    role: toMessageRole(message.role),
    status: toMessageStatus(message.status, toMessageRole(message.role)),
    createdAt: message.createdAt,
    ...(message.updatedAt && { updatedAt: message.updatedAt }),
    ...(message.modelId && { modelId: message.modelId }),
    parts: message.parts ?? [],
    blocks: message.blocks ?? []
  }
}

export function adaptAgentSessionMessage(row: AgentSessionMessageEntity): ChatMessageItem {
  const message = readPersistedMessage(row.content)
  const role = toMessageRole(message?.role ?? row.role)
  const metadataStatus = typeof row.metadata?.status === 'string' ? row.metadata.status : undefined

  return {
    id: message?.id ?? row.id,
    role,
    status: toMessageStatus(message?.status ?? metadataStatus, role),
    createdAt: message?.createdAt ?? row.createdAt,
    updatedAt: row.updatedAt,
    ...(message?.modelId && { modelId: message.modelId }),
    parts: message?.data?.parts ?? [],
    blocks: message?.blocks ?? []
  }
}

export const MessageListAdapter = {
  fromRendererMessage: adaptRendererMessage,
  fromAgentSessionMessage: adaptAgentSessionMessage
}
