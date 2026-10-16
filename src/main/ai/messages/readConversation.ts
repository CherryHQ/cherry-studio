import * as z from 'zod'

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { topicService } from '@data/services/TopicService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import { AgentSessionMessagesListQuerySchema } from '@shared/data/api/schemas/agentSessionMessages'
import { BranchMessagesQuerySchema } from '@shared/data/api/schemas/messages'
import type { Message } from '@shared/data/types/message'

export type ConversationSource = 'topic' | 'agent' | 'temporary'

export class ConversationReadError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'AMBIGUOUS' | 'INVALID_PARAMS',
    message: string
  ) {
    super(message)
    this.name = 'ConversationReadError'
  }
}

const conversationQuerySchema = z.strictObject({
  sessionId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.number().int().positive().optional(),
  nodeId: z.string().optional(),
  includeSiblings: z.boolean().optional(),
  messageId: z.string().min(1).optional()
})

export type ReadConversationInput = z.infer<typeof conversationQuerySchema>
export type ReadConversationResult = ReturnType<typeof readConversation>

type ConversationCandidate = {
  source: ConversationSource
  sessionId: string
}

function assertValidQuery(input: ReadConversationInput): void {
  const common = conversationQuerySchema.safeParse(input)
  if (!common.success)
    throw new ConversationReadError('INVALID_PARAMS', common.error.issues[0]?.message ?? 'Invalid query')
  if (
    input.messageId &&
    (input.cursor || input.nodeId || input.limit !== undefined || input.includeSiblings !== undefined)
  ) {
    throw new ConversationReadError('INVALID_PARAMS', "'message_id' cannot be combined with list query parameters")
  }
}

function tryCandidate(
  read: () => unknown,
  source: ConversationSource,
  sessionId: string
): ConversationCandidate | null {
  try {
    read()
    return { source, sessionId }
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return null
    throw error
  }
}

function identifyConversation(sessionId: string): ConversationCandidate {
  const candidates = [
    tryCandidate(() => topicService.getById(sessionId), 'topic', sessionId),
    tryCandidate(() => agentSessionService.getById(sessionId), 'agent', sessionId),
    temporaryChatService.hasTopic(sessionId) ? { source: 'temporary' as const, sessionId } : null
  ].filter((candidate): candidate is ConversationCandidate => candidate !== null)

  if (candidates.length === 0) {
    throw new ConversationReadError('NOT_FOUND', `Conversation not found: ${sessionId}`)
  }
  if (candidates.length > 1) {
    throw new ConversationReadError(
      'AMBIGUOUS',
      `Conversation id is ambiguous: ${sessionId} matches ${candidates.map((candidate) => candidate.source).join(', ')}`
    )
  }
  return candidates[0]
}

function assertSourceQuery(source: ConversationSource, input: ReadConversationInput): void {
  if (source === 'topic') {
    const result = BranchMessagesQuerySchema.safeParse({
      cursor: input.cursor,
      limit: input.limit,
      nodeId: input.nodeId,
      includeSiblings: input.includeSiblings
    })
    if (!result.success && !input.messageId) {
      throw new ConversationReadError('INVALID_PARAMS', result.error.issues[0]?.message ?? 'Invalid topic query')
    }
    return
  }
  if (source === 'agent') {
    if (input.nodeId !== undefined || input.includeSiblings !== undefined) {
      throw new ConversationReadError(
        'INVALID_PARAMS',
        "'node_id' and 'include_siblings' are only valid for topic sessions"
      )
    }
    const result = AgentSessionMessagesListQuerySchema.safeParse({ cursor: input.cursor, limit: input.limit })
    if (!result.success && !input.messageId) {
      throw new ConversationReadError('INVALID_PARAMS', result.error.issues[0]?.message ?? 'Invalid Agent query')
    }
    return
  }
  if (
    input.cursor !== undefined ||
    input.limit !== undefined ||
    input.nodeId !== undefined ||
    input.includeSiblings !== undefined ||
    input.messageId !== undefined
  ) {
    throw new ConversationReadError('INVALID_PARAMS', 'Temporary conversations do not support query parameters')
  }
}

function hasPersistentSource(
  candidate: ConversationCandidate
): candidate is ConversationCandidate & { source: 'topic' | 'agent' } {
  return candidate.source !== 'temporary'
}

function readExactMessage(
  candidate: ConversationCandidate & { source: 'topic' | 'agent' },
  messageId: string
): Message | AgentSessionMessageEntity {
  switch (candidate.source) {
    case 'topic': {
      const message = messageService.getById(messageId)
      if (message.topicId !== candidate.sessionId) {
        throw new ConversationReadError('NOT_FOUND', `Message not found in conversation: ${messageId}`)
      }
      return message
    }
    case 'agent':
      return agentSessionMessageService.getSessionMessage(candidate.sessionId, messageId)
  }
}

export function readConversation(input: ReadConversationInput) {
  assertValidQuery(input)
  const candidate = identifyConversation(input.sessionId)
  assertSourceQuery(candidate.source, input)

  if (input.messageId) {
    if (!hasPersistentSource(candidate)) {
      throw new ConversationReadError('INVALID_PARAMS', 'Temporary conversations do not support exact message reads')
    }
    const message = readExactMessage(candidate, input.messageId)
    return { source: candidate.source, sessionId: candidate.sessionId, message }
  }

  return readConversationPage(candidate, input)
}

function readConversationPage(candidate: ConversationCandidate, input: ReadConversationInput) {
  if (candidate.source === 'topic') {
    const result = messageService.getBranchMessages(candidate.sessionId, {
      cursor: input.cursor,
      limit: input.limit,
      nodeId: input.nodeId,
      includeSiblings: input.includeSiblings
    })
    return {
      source: 'topic' as const,
      sessionId: candidate.sessionId,
      messages: result.items,
      nextCursor: result.nextCursor,
      activeNodeId: result.activeNodeId,
      assistantId: result.assistantId,
      rootId: result.rootId
    }
  }
  if (candidate.source === 'agent') {
    const result = agentSessionMessageService.listSessionMessages(candidate.sessionId, {
      cursor: input.cursor,
      limit: input.limit
    })
    return {
      source: 'agent' as const,
      sessionId: candidate.sessionId,
      messages: result.items,
      nextCursor: result.nextCursor
    }
  }
  return {
    source: 'temporary' as const,
    sessionId: candidate.sessionId,
    messages: temporaryChatService.listMessages(candidate.sessionId)
  }
}

/** Read one source's selected history in chronological order without re-identifying it per page. */
export function readAllConversationMessages(input: Pick<ReadConversationInput, 'sessionId' | 'nodeId'>) {
  assertValidQuery(input)
  const candidate = identifyConversation(input.sessionId)
  const messages: Array<Message | AgentSessionMessageEntity> = []
  let cursor: string | undefined
  do {
    const page = readConversationPage(candidate, { ...input, cursor, limit: 200, includeSiblings: false })
    if (page.source === 'topic') messages.unshift(...page.messages.map((entry) => entry.message))
    else messages.push(...page.messages)
    cursor = 'nextCursor' in page ? page.nextCursor : undefined
  } while (cursor)
  return { ...candidate, messages: candidate.source === 'agent' ? messages.reverse() : messages }
}
