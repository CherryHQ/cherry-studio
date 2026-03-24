/**
 * TODO: Temporary compatibility layer — remove after message type migration.
 *
 * This module bridges the Data API (shared types) and the renderer (legacy types)
 * by converting SharedMessage → renderer Message + MessageBlock[].
 *
 * Once the renderer adopts shared types directly (Message from @shared/data/types/message),
 * this conversion layer and the separate MessageBlock store become unnecessary.
 * The renderer should consume Data API responses as-is without re-shaping.
 */
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { ErrorCode } from '@shared/data/api/apiErrors'
import type { BranchMessagesResponse, Message as SharedMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('DataApiMessageDataSource')

const FETCH_LIMIT = 999

/**
 * Fetch messages for a topic from the Data API and convert to renderer format.
 */
export async function fetchMessagesFromDataApi(topicId: string): Promise<{
  messages: Message[]
  blocks: MessageBlock[]
}> {
  try {
    const response = (await dataApiService.get(`/topics/${topicId}/messages`, {
      query: { limit: FETCH_LIMIT, includeSiblings: true }
    })) as BranchMessagesResponse

    const messages: Message[] = []
    const blocks: MessageBlock[] = []

    for (const item of response.items) {
      const result = convertSharedMessage(item.message)
      messages.push(result.message)
      blocks.push(...result.blocks)

      if (item.siblingsGroup) {
        for (const sibling of item.siblingsGroup) {
          const sibResult = convertSharedMessage(sibling)
          messages.push(sibResult.message)
          blocks.push(...sibResult.blocks)
        }
      }
    }

    logger.debug('Fetched messages from Data API', {
      topicId,
      messageCount: messages.length,
      blockCount: blocks.length
    })

    return { messages, blocks }
  } catch (error: any) {
    if (error?.code === ErrorCode.NOT_FOUND) {
      logger.debug(`Topic ${topicId} not found in Data API, returning empty`)
      return { messages: [], blocks: [] }
    }
    logger.error(`Failed to fetch messages from Data API for topic ${topicId}:`, error as Error)
    throw error
  }
}

/**
 * Convert a shared Message (Data API) to renderer Message + MessageBlock[].
 *
 * Block data was written from renderer format (minus id/status/messageId),
 * so we restore those fields with deterministic IDs based on messageId + index.
 */
function convertSharedMessage(shared: SharedMessage): {
  message: Message
  blocks: MessageBlock[]
} {
  const rendererBlocks: MessageBlock[] = []
  const blockIds: string[] = []
  const dataBlocks = shared.data?.blocks || []

  for (let i = 0; i < dataBlocks.length; i++) {
    const { type, createdAt, ...rest } = dataBlocks[i] as Record<string, any>
    const blockId = `${shared.id}-block-${i}`
    blockIds.push(blockId)

    rendererBlocks.push({
      ...rest,
      id: blockId,
      messageId: shared.id,
      type,
      status: mapBlockStatus(shared.status),
      createdAt: typeof createdAt === 'number' ? new Date(createdAt).toISOString() : createdAt || shared.createdAt
    } as MessageBlock)
  }

  const message: Message = {
    id: shared.id,
    topicId: shared.topicId,
    role: shared.role,
    assistantId: shared.assistantId || '',
    status: shared.status as Message['status'],
    blocks: blockIds,
    createdAt: shared.createdAt,
    updatedAt: shared.updatedAt,
    askId: shared.parentId ?? undefined,
    modelId: shared.modelId ?? undefined,
    traceId: shared.traceId ?? undefined,
    ...(shared.stats && {
      usage: {
        prompt_tokens: shared.stats.promptTokens ?? 0,
        completion_tokens: shared.stats.completionTokens ?? 0,
        total_tokens: shared.stats.totalTokens ?? 0
      },
      metrics: {
        completion_tokens: shared.stats.completionTokens ?? 0,
        time_completion_millsec: shared.stats.timeCompletionMs ?? 0,
        time_first_token_millsec: shared.stats.timeFirstTokenMs,
        time_thinking_millsec: shared.stats.timeThinkingMs
      }
    })
  }

  return { message, blocks: rendererBlocks }
}

function mapBlockStatus(messageStatus: string): MessageBlockStatus {
  switch (messageStatus) {
    case 'success':
      return MessageBlockStatus.SUCCESS
    case 'error':
      return MessageBlockStatus.ERROR
    case 'paused':
      return MessageBlockStatus.PAUSED
    case 'pending':
      return MessageBlockStatus.PENDING
    default:
      return MessageBlockStatus.SUCCESS
  }
}
