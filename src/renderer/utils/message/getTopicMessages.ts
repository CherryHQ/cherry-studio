import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { MessageExportView } from '@renderer/types/messageExport'
import { ErrorCode } from '@shared/data/api/errors'
import { type BranchMessagesResponse, type Message as SharedMessage, toContentRole } from '@shared/data/types/message'
import { hasClearContextPart, isBlankUserTurn } from '@shared/data/types/uiParts'

import { withPriorCitationParts } from './exportView'

const logger = loggerService.withContext('getTopicMessages')

// Per-page size for `getTopicMessages`. Consumers (export, knowledge
// analysis, topic rename) want the full branch — `getTopicMessages`
// follows nextCursor until the server has nothing left rather than
// hard-capping at one large page.
const MESSAGES_PAGE_SIZE = 200

function isRenderableTopicMessage(message: SharedMessage): boolean {
  const parts = message.data.parts ?? []
  return !hasClearContextPart(parts) && !isBlankUserTurn({ role: message.role, status: message.status, parts })
}

/**
 * Load and return all messages for a topic.
 *
 * Fetches directly from DataApi (SQLite) and follows the cursor to
 * completion. Each returned `Message` carries its `parts` (V2
 * source-of-truth), so `find.ts` / `filters.ts` utils resolve content
 * from `message.parts` without touching the renderer's legacy
 * `messageBlocks` Redux slice.
 *
 * Pagination semantics (`getBranchMessages` in main):
 *   - "before cursor" → first page = newest tail, each subsequent page
 *     walks older toward the root.
 *   - Items within a page are root-style ordered (oldest first).
 * To return the full branch in chronological order, we collect pages and
 * concat in reverse fetch order (oldest page first, newest last).
 *
 * Used by one-off consumers (export, knowledge analysis, topic rename
 * pre-check). The main chat UI reads messages via `useTopicMessages`.
 *
 * `maxMessages` stops paging once that many of the newest messages are in
 * hand, for consumers (composer references) that only need a recent tail.
 */
export async function getTopicMessages(
  id: string,
  options: { maxMessages?: number } = {}
): Promise<MessageExportView[]> {
  try {
    const pages: MessageExportView[][] = []
    let assistantId = ''
    let cursor: string | undefined
    let collected = 0

    do {
      const response = (await dataApiService.get(`/topics/${id}/messages`, {
        query: { limit: MESSAGES_PAGE_SIZE, includeSiblings: true, cursor }
      })) as BranchMessagesResponse

      // Topic-level fields are stable across pages; first response wins.
      if (!cursor) assistantId = response.assistantId ?? ''

      const pageMessages: MessageExportView[] = []
      for (const item of response.items) {
        if (isRenderableTopicMessage(item.message)) {
          pageMessages.push(convertSharedMessage(item.message, assistantId))
        }
        if (item.siblingsGroup) {
          for (const sibling of item.siblingsGroup) {
            if (isRenderableTopicMessage(sibling)) {
              pageMessages.push(convertSharedMessage(sibling, assistantId))
            }
          }
        }
      }
      pages.push(pageMessages)
      collected += pageMessages.length

      cursor = response.nextCursor
    } while (cursor && (!options.maxMessages || collected < options.maxMessages))

    return withPriorCitationParts(pages.reverse().flat())
  } catch (error: unknown) {
    if (error instanceof Object && 'code' in error && error.code === ErrorCode.NOT_FOUND) {
      logger.debug(`Topic ${id} not found in Data API, returning empty`)
      return []
    }
    logger.error(`Failed to fetch messages from Data API for topic ${id}:`, error as Error)
    throw error
  }
}

/**
 * Project a shared `Message` (Data API) onto the export-oriented
 * `MessageExportView`. The `parts` field carries the V2 source-of-truth
 * straight through — these messages flow only into export / knowledge /
 * topic-rename readers, which read `parts` (never v1 blocks).
 */
function convertSharedMessage(shared: SharedMessage, assistantId: string): MessageExportView {
  return {
    id: shared.id,
    assistantId,
    topicId: shared.topicId,
    role: toContentRole(shared.role),
    status: shared.status,
    parts: shared.data?.parts ?? [],
    createdAt: shared.createdAt,
    updatedAt: shared.updatedAt,
    parentId: shared.parentId ?? undefined,
    modelId: shared.modelId ?? undefined,
    // Carry the frozen author so export headers survive assistant/agent rename/delete.
    ...(shared.messageSnapshot && { messageSnapshot: shared.messageSnapshot }),
    ...(shared.stats && { stats: shared.stats })
  }
}
