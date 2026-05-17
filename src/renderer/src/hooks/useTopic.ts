/**
 * Topic data layer — three tiers in one module:
 *
 *  1. Pure / non-React helpers — `mapApiTopicToRendererTopic`,
 *     `getTopicById`, `getTopicMessages`, topic-rename cache helpers.
 *  2. DataApi tier — raw SQLite-backed queries/mutations
 *     (`useAllTopics` / `useTopicById` / `useTopicMutations` / `useTopicSync`).
 *  3. Composed hook — `useActiveTopic`.
 *
 * Returns the canonical {@link Topic} entity straight from SQLite. The
 * transitional {@link mapApiTopicToRendererTopic} helper bridges to the v1
 * renderer shape for callers that haven't migrated yet — it'll be removed
 * once Phase 2 finishes.
 */

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { useSharedCache } from '@data/hooks/useCache'
import {
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  useQuery
} from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Message, Topic as RendererTopic } from '@renderer/types'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import { ErrorCode } from '@shared/data/api/apiErrors'
import type { CreateTopicDto, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import type { BranchMessagesResponse, Message as SharedMessage } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useTopic')

// ─── Tier 1: pure / non-React helpers ─────────────────────────────────────

const EMPTY_TOPICS: readonly Topic[] = Object.freeze([])

/**
 * Map a DataApi topic entity into the renderer {@link RendererTopic} shape.
 * Message history is not loaded here — use `useTopicMessagesV2` or `getTopicMessages`.
 *
 * Pin state is no longer a topic column; consumers that need "is this pinned?"
 * read the `pin` collection (`useQuery('/pins', { query: { entityType: 'topic' } })`)
 * and check membership. The legacy `pinned` flag on the renderer Topic is
 * always `false` here — consumers reading it directly need to migrate.
 *
 * @deprecated Transitional adapter — call sites should migrate to the DataApi
 * `Topic` shape directly (no `messages[]`, no `pinned` flag — use `/pins`).
 */
export function mapApiTopicToRendererTopic(t: Topic): RendererTopic {
  return {
    id: t.id,
    assistantId: t.assistantId,
    name: t.name ?? '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: [],
    pinned: false,
    isNameManuallyEdited: t.isNameManuallyEdited
  }
}

export async function getTopicById(topicId: string): Promise<RendererTopic> {
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

// ─── Tier 2: raw DataApi queries/mutations ────────────────────────────────

/**
 * List topics across all assistants from SQLite via DataApi.
 *
 * Backed by `useInfiniteQuery` cursor pagination — `/topics` returns a
 * server-composed view (pinned topics first via the `pin` table, then
 * unpinned ordered by `topic.orderKey`). Consumers that genuinely need the
 * full list (`loadAll: true`) auto-paginate to the end; consumers that just
 * want progressive loading (sidebar) leave it `undefined` and call
 * `loadNext()` themselves.
 *
 * `q` triggers server-side LIKE search on `topic.name`.
 */
export function useAllTopics(opts?: { q?: string; loadAll?: boolean }) {
  const query = opts?.q?.trim() ? { q: opts.q.trim() } : undefined
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh, mutate } = useInfiniteQuery('/topics', {
    query,
    limit: 50
  })
  const topics = useInfiniteFlatItems(pages)

  // Auto-paginate to completion when the caller wants the full list. The
  // sidebar leaves `loadAll` unset and drives `loadNext` from scroll
  // position so paging is visible to the user.
  useEffect(() => {
    if (opts?.loadAll && hasNext && !isLoading && !isRefreshing) {
      loadNext()
    }
  }, [opts?.loadAll, hasNext, isLoading, isRefreshing, loadNext])

  return {
    topics: topics.length > 0 ? topics : EMPTY_TOPICS,
    pages,
    hasNext,
    loadNext,
    isLoading,
    isRefreshing,
    error,
    refetch: refresh,
    mutate
  }
}

/**
 * Fetch a single topic by id from SQLite via DataApi.
 */
export function useTopicById(topicId: string | undefined) {
  const { data, isLoading, error, refetch, mutate } = useQuery(`/topics/${topicId}`, {
    enabled: !!topicId
  })

  return {
    topic: data,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Topic mutations (create / update / delete) backed by DataApi.
 */
export function useTopicMutations() {
  const invalidate = useInvalidateCache()

  const { trigger: createTrigger, isLoading: isCreating } = useMutation('POST', '/topics', {
    refresh: ['/topics']
  })
  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', '/topics/:id', {
    refresh: ({ args }) => ['/topics', `/topics/${args!.params.id}`]
  })
  const { trigger: deleteTrigger, isLoading: isDeleting } = useMutation('DELETE', '/topics/:id', {
    // After delete, only invalidate the list — refreshing `/topics/:id`
    // would trigger a fetch that 404s and caches an error in SWR.
    refresh: ['/topics']
  })

  const refreshTopics = useCallback(() => invalidate('/topics'), [invalidate])

  const createTopic = useCallback(
    async (dto: CreateTopicDto): Promise<Topic> => {
      const topic = await createTrigger({ body: dto })
      logger.info('Created topic', { id: topic.id })
      return topic
    },
    [createTrigger]
  )

  const updateTopic = useCallback(
    async (topicId: string, dto: UpdateTopicDto): Promise<Topic> => {
      const topic = await updateTrigger({ params: { id: topicId }, body: dto })
      logger.info('Updated topic', { id: topicId })
      return topic
    },
    [updateTrigger]
  )

  const deleteTopic = useCallback(
    async (topicId: string): Promise<void> => {
      await deleteTrigger({ params: { id: topicId } })
      logger.info('Deleted topic', { id: topicId })
    },
    [deleteTrigger]
  )

  const batchUpdateTopics = useCallback(
    async (topics: Array<{ id: string; dto: UpdateTopicDto }>): Promise<void> => {
      await Promise.allSettled(topics.map(({ id, dto }) => dataApiService.patch(`/topics/${id}`, { body: dto })))
      await refreshTopics()
    },
    [refreshTopics]
  )

  return {
    createTopic,
    updateTopic,
    deleteTopic,
    batchUpdateTopics,
    refreshTopics,
    isCreating,
    isUpdating,
    isDeleting
  }
}

/**
 * Listens for topic updates from the main process (e.g. auto-rename)
 * and invalidates the SWR topic cache so UI reflects the change.
 */
export function useTopicSync() {
  const [version] = useSharedCache('topic.cache_version')
  const invalidate = useInvalidateCache()
  const lastSeenRef = useRef(version)

  useEffect(() => {
    if (version === lastSeenRef.current) return
    lastSeenRef.current = version
    void invalidate(['/topics', '/topics/*'])
  }, [version, invalidate])
}

// ─── Tier 3: composed hook ────────────────────────────────────────────────

export function useActiveTopic(topic?: RendererTopic, options: { autoPickFirst?: boolean } = {}) {
  const { autoPickFirst = true } = options
  const { topics: apiTopics, isLoading } = useAllTopics({ loadAll: true })
  const topics = useMemo(() => apiTopics.map(mapApiTopicToRendererTopic), [apiTopics])
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(
    () => topic?.id ?? cacheService.get('topic.active')?.id
  )
  // Holds the last Topic object passed to setActiveTopic, used as fallback when
  // the newly-added topic is not yet in `topics` (SWR still refetching).
  const [pendingTopic, setPendingTopic] = useState<RendererTopic | undefined>(
    () => topic ?? cacheService.get('topic.active') ?? undefined
  )

  useEffect(() => {
    if (!topic) return
    setActiveTopicId((prev) => prev ?? topic.id)
    setPendingTopic((prev) => prev ?? topic)
  }, [topic])

  const activeTopic = useMemo<RendererTopic | undefined>(() => {
    if (!activeTopicId) return pendingTopic ?? (autoPickFirst ? topics[0] : undefined)
    const fromList = topics.find((t) => t.id === activeTopicId)
    if (fromList) return fromList
    if (pendingTopic?.id === activeTopicId) return pendingTopic
    return undefined
  }, [activeTopicId, topics, pendingTopic, autoPickFirst])

  const setActiveTopic = useCallback((next: RendererTopic) => {
    setActiveTopicId((prev) => (prev === next.id ? prev : next.id))
    setPendingTopic(next)
  }, [])

  // Reconcile activeTopicId against the loaded list in a single effect:
  //   - cold start: no active topic yet → pick first (when autoPickFirst).
  //   - active topic was deleted: not in list AND not a recent optimistic
  //     add (`pendingTopic`) → fall back to first remaining.
  // Two separate effects could each call `setActiveTopicId(topics[0].id)`
  // for the same id from different conditions in the same commit, then
  // the downstream `EVENT_NAMES.CHANGE_TOPIC` emit would fire twice.
  useEffect(() => {
    if (topics.length === 0) return

    if (!activeTopicId) {
      if (autoPickFirst) setActiveTopicId(topics[0].id)
      return
    }

    const found = topics.some((t) => t.id === activeTopicId)
    const isPending = pendingTopic?.id === activeTopicId
    if (!found && !isPending) {
      setActiveTopicId(topics[0].id)
      setPendingTopic(topics[0])
    }
  }, [activeTopicId, topics, pendingTopic, autoPickFirst])

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
