import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { fileEntryService } from '@data/services/FileEntryService'
import { messageService } from '@data/services/MessageService'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { inflateEntities, isToolOutputBlobEntry, reconstructOutput } from '@main/ai/contextBuild/toolOutputStore'
import type { AiToolResultResponse, PersistedToolOutput, PersistedToolOutputBlobRef } from '@shared/ai/transport'
import { blobRefsOf, isPersistedToolOutput } from '@shared/ai/transport'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import { AgentSessionMessagesListQuerySchema } from '@shared/data/api/schemas/agentSessionMessages'
import { BranchMessagesQuerySchema } from '@shared/data/api/schemas/messages'
import type { BranchMessagesResponse, Message } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'
import * as z from 'zod'

const logger = loggerService.withContext('ai:readConversation')

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

export interface ReadConversationInput {
  sessionId: string
  cursor?: string
  limit?: number
  nodeId?: string
  includeSiblings?: boolean
  messageId?: string
  toolCallId?: string
}

export type ReadConversationResult =
  | {
      source: 'topic'
      sessionId: string
      messages: BranchMessagesResponse['items']
      nextCursor?: string
      activeNodeId: string | null
      assistantId: string | null
      rootId: string | null
    }
  | {
      source: 'agent'
      sessionId: string
      messages: AgentSessionMessageEntity[]
      nextCursor?: string
    }
  | {
      source: 'temporary'
      sessionId: string
      messages: Message[]
    }
  | {
      source: ConversationSource
      sessionId: string
      message: Message | AgentSessionMessageEntity
    }

type ConversationCandidate = {
  source: ConversationSource
  sessionId: string
}

function assertValidQuery(input: ReadConversationInput): void {
  const common = z
    .strictObject({
      sessionId: z.string().min(1),
      cursor: z.string().optional(),
      limit: z.number().int().positive().optional(),
      nodeId: z.string().optional(),
      includeSiblings: z.boolean().optional(),
      messageId: z.string().min(1).optional(),
      toolCallId: z.string().min(1).optional()
    })
    .safeParse(input)
  if (!common.success)
    throw new ConversationReadError('INVALID_PARAMS', common.error.issues[0]?.message ?? 'Invalid query')
  if (input.toolCallId && !input.messageId) {
    throw new ConversationReadError('INVALID_PARAMS', "'tool_call_id' requires 'message_id'")
  }
  if (
    input.messageId &&
    (input.cursor || input.nodeId || input.limit !== undefined || input.includeSiblings !== undefined)
  ) {
    throw new ConversationReadError('INVALID_PARAMS', "'message_id' cannot be combined with list query parameters")
  }
  if (input.toolCallId && input.limit !== undefined) {
    throw new ConversationReadError('INVALID_PARAMS', "'tool_call_id' cannot be combined with 'limit'")
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
    input.messageId !== undefined ||
    input.toolCallId !== undefined
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

export function readConversation(input: ReadConversationInput): ReadConversationResult {
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

  if (candidate.source === 'topic') {
    const result = messageService.getBranchMessages(candidate.sessionId, {
      cursor: input.cursor,
      limit: input.limit,
      nodeId: input.nodeId,
      includeSiblings: input.includeSiblings
    })
    return {
      source: 'topic',
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
    return { source: 'agent', sessionId: candidate.sessionId, messages: result.items, nextCursor: result.nextCursor }
  }
  return {
    source: 'temporary',
    sessionId: candidate.sessionId,
    messages: temporaryChatService.listMessages(candidate.sessionId)
  }
}

export async function findPersistedToolOutput(
  topicId: string,
  messageId: string,
  toolCallId: string
): Promise<AiToolResultResponse> {
  try {
    const parts = isAgentSessionTopic(topicId)
      ? agentSessionMessageService.getSessionMessage(extractAgentSessionId(topicId), messageId).data.parts
      : messageService.getById(messageId).data.parts
    for (const part of parts ?? []) {
      if (!isToolUIPart(part) || part.state !== 'output-available') continue
      if (part.toolCallId !== toolCallId) continue
      if (isPersistedToolOutput(part.output)) {
        return { found: true, output: await resolvePersistedToolOutput(part.output) }
      }
      return { found: true, output: part.output }
    }
  } catch (error) {
    // Preserve ai.tool.get_result's miss contract; readable envelopes can still
    // degrade to an excerpt when their blob is unavailable.
    logger.warn('persisted tool result lookup failed', { topicId, messageId, toolCallId, error })
  }
  return { found: false }
}

async function resolvePersistedToolOutput(output: PersistedToolOutput): Promise<unknown> {
  const ref = output.$persistedToolOutput
  const readBlob = async (blob: PersistedToolOutputBlobRef): Promise<string> => {
    try {
      const entry = fileEntryService.findById(blob.fileEntryId)
      if (!entry || !isToolOutputBlobEntry(entry)) throw new Error('entry is not a persisted tool-output blob')
      const { content } = await application.get('FileManager').read(blob.fileEntryId, { encoding: 'text' })
      return content
    } catch (error) {
      logger.warn('persisted tool output unavailable, serving excerpt', { fileEntryId: blob.fileEntryId, error })
      return `${blob.head}\n\n[persisted output no longer available — showing excerpt of ${blob.totalChars} chars]\n\n${blob.tail}`
    }
  }
  if (ref.shape === 'entities') {
    const texts = Object.fromEntries(
      await Promise.all(ref.blobRefs.map(async (blob) => [blob.key, await readBlob(blob)] as const))
    )
    return inflateEntities(ref, texts)
  }
  return reconstructOutput(ref, await readBlob(blobRefsOf(ref)[0]))
}
