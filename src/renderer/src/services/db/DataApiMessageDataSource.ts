/**
 * Thin renderer-side fetcher for topic messages.
 *
 * Returns each message in the renderer's `Message` shape with its V2 parts
 * preserved on `Message.parts` — that's the source of truth `find.ts` /
 * `filters.ts` read from. No v1→block synthesis happens here; the legacy
 * `messageBlocks` Redux slice is no longer populated by this path.
 */
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Message } from '@renderer/types/newMessage'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import { ErrorCode } from '@shared/data/api/apiErrors'
import type { BranchMessagesResponse, Message as SharedMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('DataApiMessageDataSource')

const FETCH_LIMIT = 999

/**
 * Fetch messages for a topic from the Data API.
 *
 * The response embeds `assistantId` at top level so we don't need a
 * separate `/topics/:id` round-trip to enrich each message — see
 * `BranchMessagesResponse.assistantId`.
 */
export async function fetchMessagesFromDataApi(topicId: string): Promise<{ messages: Message[] }> {
  try {
    const response = (await dataApiService.get(`/topics/${topicId}/messages`, {
      query: { limit: FETCH_LIMIT, includeSiblings: true }
    })) as BranchMessagesResponse

    const assistantId = response.assistantId ?? ''
    const messages: Message[] = []

    for (const item of response.items) {
      messages.push(convertSharedMessage(item.message, assistantId))

      if (item.siblingsGroup) {
        for (const sibling of item.siblingsGroup) {
          messages.push(convertSharedMessage(sibling, assistantId))
        }
      }
    }

    logger.debug('Fetched messages from Data API', { topicId, messageCount: messages.length })
    return { messages }
  } catch (error: unknown) {
    if (error instanceof Object && 'code' in error && error.code === ErrorCode.NOT_FOUND) {
      logger.debug(`Topic ${topicId} not found in Data API, returning empty`)
      return { messages: [] }
    }
    logger.error(`Failed to fetch messages from Data API for topic ${topicId}:`, error as Error)
    throw error
  }
}

/**
 * Project a shared `Message` (Data API) onto the renderer's `Message`. The
 * `parts` field carries the V2 source-of-truth straight through; `blocks`
 * is left empty because the legacy Redux blocks slice is no longer
 * consulted by `find.ts` / `filters.ts` when `parts` is present.
 */
function convertSharedMessage(shared: SharedMessage, assistantId: string): Message {
  return {
    id: shared.id,
    assistantId,
    topicId: shared.topicId,
    role: shared.role,
    status: shared.status as Message['status'],
    blocks: [],
    parts: shared.data?.parts ?? [],
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
}
