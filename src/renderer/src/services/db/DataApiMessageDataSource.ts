/**
 * Temporary compatibility layer — remove after renderer adopts UIMessage.parts rendering.
 *
 * Converts Data API SharedMessage (with data.parts in AI SDK UIMessage format)
 * into renderer legacy Message + MessageBlock[] for existing rendering components.
 *
 * Once the renderer reads UIMessage.parts directly, this module becomes unnecessary.
 */
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import { mapMessageStatusToBlockStatus, partToBlock } from '@renderer/utils/partsToBlocks'
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
    // Fetch topic to get assistantId (messages no longer store it directly)
    const topic = await dataApiService.get(`/topics/${topicId}`)
    const assistantId = topic.assistantId ?? ''

    const response = (await dataApiService.get(`/topics/${topicId}/messages`, {
      query: { limit: FETCH_LIMIT, includeSiblings: true }
    })) as BranchMessagesResponse

    const messages: Message[] = []
    const blocks: MessageBlock[] = []

    for (const item of response.items) {
      const result = convertSharedMessage(item.message, assistantId)
      messages.push(result.message)
      blocks.push(...result.blocks)

      if (item.siblingsGroup) {
        for (const sibling of item.siblingsGroup) {
          const sibResult = convertSharedMessage(sibling, assistantId)
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
  } catch (error: unknown) {
    if (error instanceof Object && 'code' in error && error.code === ErrorCode.NOT_FOUND) {
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
 * Messages are stored in data.parts (AI SDK UIMessage.parts format).
 * Parts are converted back to renderer MessageBlock[] with deterministic IDs
 * based on messageId + index.
 */
function convertSharedMessage(
  shared: SharedMessage,
  assistantId: string
): {
  message: Message
  blocks: MessageBlock[]
} {
  const rendererBlocks: MessageBlock[] = []
  const blockIds: string[] = []

  // data.parts is the canonical storage format after v2 migration.
  // TODO: Remove this compatibility layer when renderer adopts UIMessage.parts rendering
  const dataParts = shared.data?.parts || []
  const status = mapMessageStatusToBlockStatus(shared.status)

  for (let i = 0; i < dataParts.length; i++) {
    const part = dataParts[i]
    const blockId = `${shared.id}-block-${i}`

    const block = partToBlock(part, blockId, shared.id, shared.createdAt, status)
    if (block) {
      blockIds.push(blockId)
      rendererBlocks.push(block)
    }
  }

  const message: Message = {
    id: shared.id,
    assistantId,
    topicId: shared.topicId,
    role: shared.role,
    status: shared.status as Message['status'],
    blocks: blockIds,
    createdAt: shared.createdAt,
    updatedAt: shared.updatedAt,
    askId: shared.parentId ?? undefined,
    modelId: shared.modelId ?? undefined,
    traceId: shared.traceId ?? undefined,
    ...(shared.stats && {
      usage: statsToUsage(shared.stats),
      metrics: statsToMetrics(shared.stats)
    })
  }

  return { message, blocks: rendererBlocks }
}
