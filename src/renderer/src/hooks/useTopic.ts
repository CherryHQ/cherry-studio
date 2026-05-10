import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { mapApiTopicToRendererTopic, useAllTopics } from '@renderer/hooks/useTopicDataApi'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message, Topic } from '@renderer/types'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import { ErrorCode } from '@shared/data/api/apiErrors'
import type { BranchMessagesResponse, Message as SharedMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useMemo, useState } from 'react'

const logger = loggerService.withContext('useTopic')

export function useActiveTopic(topic?: Topic, options: { autoPickFirst?: boolean } = {}) {
  const { autoPickFirst = true } = options
  const { topics: apiTopics, isLoading } = useAllTopics({ loadAll: true })
  const topics = useMemo(() => apiTopics.map(mapApiTopicToRendererTopic), [apiTopics])
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(
    () => topic?.id ?? cacheService.get('topic.active')?.id
  )
  // Holds the last Topic object passed to setActiveTopic, used as fallback when
  // the newly-added topic is not yet in `topics` (SWR still refetching).
  const [pendingTopic, setPendingTopic] = useState<Topic | undefined>(
    () => topic ?? cacheService.get('topic.active') ?? undefined
  )

  useEffect(() => {
    if (!topic) return
    setActiveTopicId((prev) => prev ?? topic.id)
    setPendingTopic((prev) => prev ?? topic)
  }, [topic])

  const activeTopic = useMemo<Topic | undefined>(() => {
    if (!activeTopicId) return pendingTopic ?? (autoPickFirst ? topics[0] : undefined)
    const fromList = topics.find((t) => t.id === activeTopicId)
    if (fromList) return fromList
    if (pendingTopic?.id === activeTopicId) return pendingTopic
    return undefined
  }, [activeTopicId, topics, pendingTopic, autoPickFirst])

  const setActiveTopic = useCallback((next: Topic) => {
    setActiveTopicId((prev) => (prev === next.id ? prev : next.id))
    setPendingTopic(next)
  }, [])

  // When no topic is selected yet and the list has loaded, pick the first one
  useEffect(() => {
    if (!autoPickFirst) return
    if (!activeTopicId && topics.length > 0) {
      setActiveTopicId(topics[0].id)
    }
  }, [activeTopicId, topics, autoPickFirst])

  // If the active topic was deleted (existed in list before, now gone), fall back
  // to the first remaining topic. `pendingTopic` mismatch means it's neither
  // in the list nor a recent optimistic add — i.e. truly deleted.
  useEffect(() => {
    if (!activeTopicId || topics.length === 0) return
    const found = topics.some((t) => t.id === activeTopicId)
    const isPending = pendingTopic?.id === activeTopicId
    if (!found && !isPending) {
      setActiveTopicId(topics[0].id)
      setPendingTopic(topics[0])
    }
  }, [activeTopicId, topics, pendingTopic])

  useEffect(() => {
    if (activeTopic) {
      void EventEmitter.emit(EVENT_NAMES.CHANGE_TOPIC, activeTopic)
    }
  }, [activeTopic])

  useEffect(() => {
    if (activeTopic) {
      cacheService.set('topic.active', activeTopic)
    }
  }, [activeTopic])

  return { activeTopic, setActiveTopic, isLoading }
}

export async function getTopicById(topicId: string): Promise<Topic> {
  const apiTopic = await dataApiService.get(`/topics/${topicId}`)
  const topic = mapApiTopicToRendererTopic(apiTopic)
  const messages = await getTopicMessages(topicId)
  return { ...topic, messages }
}

/**
 * 开始重命名指定话题
 */
export const startTopicRenaming = (topicId: string) => {
  const currentIds = cacheService.get('topic.renaming') ?? []
  if (!currentIds.includes(topicId)) {
    cacheService.set('topic.renaming', [...currentIds, topicId])
  }
}

/**
 * 完成重命名指定话题
 */
export const finishTopicRenaming = (topicId: string) => {
  // 1. 立即从 renamingTopics 移除
  const renamingTopics = cacheService.get('topic.renaming')
  if (renamingTopics && renamingTopics.includes(topicId)) {
    cacheService.set(
      'topic.renaming',
      renamingTopics.filter((id) => id !== topicId)
    )
  }

  // 2. 立即添加到 newlyRenamedTopics
  const currentNewlyRenamed = cacheService.get('topic.newly_renamed') ?? []
  cacheService.set('topic.newly_renamed', [...currentNewlyRenamed, topicId])

  // 3. 延迟从 newlyRenamedTopics 移除
  setTimeout(() => {
    const current = cacheService.get('topic.newly_renamed') ?? []
    cacheService.set(
      'topic.newly_renamed',
      current.filter((id) => id !== topicId)
    )
  }, 700)
}

// Per-page size for `getTopicMessages`. Consumers (export, knowledge
// analysis, topic rename) want the full branch — `getTopicMessages`
// follows nextCursor until the server has nothing left rather than
// hard-capping at one large page.
const MESSAGES_PAGE_SIZE = 200

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
 * pre-check). The main chat UI reads messages via `useTopicMessagesV2`.
 */
export async function getTopicMessages(id: string): Promise<Message[]> {
  try {
    const pages: Message[][] = []
    let assistantId = ''
    let cursor: string | undefined

    do {
      const response = (await dataApiService.get(`/topics/${id}/messages`, {
        query: { limit: MESSAGES_PAGE_SIZE, includeSiblings: true, cursor }
      })) as BranchMessagesResponse

      // Topic-level fields are stable across pages; first response wins.
      if (!cursor) assistantId = response.assistantId ?? ''

      const pageMessages: Message[] = []
      for (const item of response.items) {
        pageMessages.push(convertSharedMessage(item.message, assistantId))
        if (item.siblingsGroup) {
          for (const sibling of item.siblingsGroup) {
            pageMessages.push(convertSharedMessage(sibling, assistantId))
          }
        }
      }
      pages.push(pageMessages)

      cursor = response.nextCursor
    } while (cursor)

    return pages.reverse().flat()
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
