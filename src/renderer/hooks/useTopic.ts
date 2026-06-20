/**
 * Topic data layer — three tiers in one module:
 *
 *  1. Pure / non-React helpers — `mapApiTopicToRendererTopic`,
 *     `getTopicById`, `getTopicMessages`, topic-rename cache helpers.
 *  2. DataApi tier — raw SQLite-backed queries/mutations
 *     (`useTopics` / `useTopicById` / `useTopicMutations` / `useTopicAutoRenameSync`).
 *  3. Composed hook — `useActiveTopic`.
 *
 * Returns the canonical {@link Topic} entity straight from SQLite. The
 * transitional {@link mapApiTopicToRendererTopic} helper bridges to the v1
 * renderer shape for callers that haven't migrated yet — it'll be removed
 * once Phase 2 finishes.
 */

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import {
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  useQuery
} from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic as RendererTopic } from '@renderer/types'
import type { MessageExportView } from '@renderer/types/messageExport'
import { ErrorCode } from '@shared/data/api/apiErrors'
import type { CreateTopicDto, DeleteTopicsResult, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import { type BranchMessagesResponse, type Message as SharedMessage, toContentRole } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useTopic')

// ─── Tier 1: pure / non-React helpers ─────────────────────────────────────

const EMPTY_TOPICS: readonly Topic[] = Object.freeze([])
const DEFAULT_TOPIC_PAGE_SIZE = 50
const LOAD_ALL_TOPIC_PAGE_SIZE = 200

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
    orderKey: t.orderKey,
    traceId: t.traceId,
    messages: [],
    pinned: false,
    isNameManuallyEdited: t.isNameManuallyEdited
  }
}

export async function getTopicById(topicId: string): Promise<RendererTopic> {
  const apiTopic = await dataApiService.get(`/topics/${topicId}`)
  // `messages` stays empty — the sole caller reads only topic metadata
  // (`topic.id`); message history is fetched on demand via `getTopicMessages`.
  return mapApiTopicToRendererTopic(apiTopic)
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
 * pre-check). The main chat UI reads messages via `useTopicMessages`.
 */
export async function getTopicMessages(id: string): Promise<MessageExportView[]> {
  try {
    const pages: MessageExportView[][] = []
    let assistantId = ''
    let cursor: string | undefined

    do {
      const response = (await dataApiService.get(`/topics/${id}/messages`, {
        query: { limit: MESSAGES_PAGE_SIZE, includeSiblings: true, cursor }
      })) as BranchMessagesResponse

      // Topic-level fields are stable across pages; first response wins.
      if (!cursor) assistantId = response.assistantId ?? ''

      const pageMessages: MessageExportView[] = []
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
    ...(shared.stats && { stats: shared.stats })
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
export function useTopics(opts?: { q?: string; loadAll?: boolean; pageSize?: number }) {
  const query = opts?.q?.trim() ? { q: opts.q.trim() } : undefined
  const loadAll = opts?.loadAll === true
  const pageSize = opts?.pageSize ?? (loadAll ? LOAD_ALL_TOPIC_PAGE_SIZE : DEFAULT_TOPIC_PAGE_SIZE)
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh, mutate } = useInfiniteQuery('/topics', {
    query,
    limit: pageSize
  })
  const topics = useInfiniteFlatItems(pages)
  const isFullyLoaded = !loadAll || (!isLoading && !hasNext)
  const isLoadingAll = isLoading || (loadAll && hasNext)

  // Auto-paginate to completion when the caller wants the full list. The
  // sidebar leaves `loadAll` unset and drives `loadNext` from scroll
  // position so paging is visible to the user.
  useEffect(() => {
    if (loadAll && hasNext && !isLoading && !isRefreshing) {
      loadNext()
    }
  }, [loadAll, hasNext, isLoading, isRefreshing, loadNext])

  return {
    topics: topics.length > 0 ? topics : EMPTY_TOPICS,
    pages,
    hasNext,
    loadNext,
    isLoading,
    isLoadingAll,
    isFullyLoaded,
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
  const { trigger: deleteManyTrigger, isLoading: isDeletingMany } = useMutation('DELETE', '/topics', {
    refresh: ['/topics', '/pins']
  })
  const { trigger: deleteByAssistantTrigger } = useMutation('DELETE', '/assistants/:assistantId/topics', {
    refresh: ['/topics', '/pins']
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

  const deleteTopics = useCallback(
    async (ids: string[]): Promise<DeleteTopicsResult> => {
      const result = await deleteManyTrigger({ query: { ids: ids.join(',') } })
      logger.info('Deleted topics', { count: result.deletedCount })
      return result
    },
    [deleteManyTrigger]
  )

  const deleteTopicsByAssistantId = useCallback(
    async (assistantId: string): Promise<DeleteTopicsResult> => {
      const result = await deleteByAssistantTrigger({ params: { assistantId } })
      logger.info('Deleted assistant topics', { assistantId, count: result.deletedCount })
      return result
    },
    [deleteByAssistantTrigger]
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
    deleteTopics,
    deleteTopicsByAssistantId,
    batchUpdateTopics,
    refreshTopics,
    isCreating,
    isUpdating,
    isDeleting: isDeleting || isDeletingMany
  }
}

/**
 * Listens for `IpcChannel.Topic_AutoRenamed` and invalidates the renamed
 * topic's SWR cache so the new name shows up without manual refetch.
 */
export function useTopicAutoRenameSync() {
  const invalidate = useInvalidateCache()

  useEffect(() => {
    const onAutoRenamed = window.api?.topic?.onAutoRenamed
    if (!onAutoRenamed) return
    const unsubscribe = onAutoRenamed(({ topicId }) => {
      void invalidate(['/topics', `/topics/${topicId}`])
    })
    return () => {
      unsubscribe()
    }
  }, [invalidate])
}

// ─── Tier 3: composed hook ────────────────────────────────────────────────

export type ActiveTopicSource = 'query' | 'pending' | 'none'

export interface UseActiveTopicOptions {
  /** Optimistic / pending Topic (e.g. just-created temp topic not yet in list) */
  initialTopic?: RendererTopic
  /** External source of truth for active topic id (HomePage drives from URL). */
  activeTopicId: string | null
  /** Write back when initialTopic or setActiveTopic fires. */
  setActiveTopicId: (id: string | null) => void
  /**
   * Pass `true` for callers that don't want any reconciliation or visible
   * activeTopic (e.g. message-only view loads its target via `useTopicById`).
   * In passive mode the hook becomes a no-op except for tracking `pendingTopic`.
   */
  passive?: boolean
}

export function useActiveTopic({
  initialTopic,
  activeTopicId,
  setActiveTopicId,
  passive = false
}: UseActiveTopicOptions) {
  const { topics: apiTopics, isLoading } = useTopics({ loadAll: true })
  const topics = useMemo(() => apiTopics.map(mapApiTopicToRendererTopic), [apiTopics])
  // Holds the last Topic object passed to setActiveTopic, used as fallback when
  // the newly-added topic is not yet in `topics` (SWR still refetching).
  const [pendingTopic, setPendingTopic] = useState<RendererTopic | undefined>(() => initialTopic ?? undefined)
  const hasAppliedInitialTopicRef = useRef(false)

  useEffect(() => {
    if (passive) return
    if (!initialTopic) return
    setPendingTopic((prev) => prev ?? initialTopic)
    if (hasAppliedInitialTopicRef.current) return

    hasAppliedInitialTopicRef.current = true
    if (activeTopicId !== initialTopic.id) setActiveTopicId(initialTopic.id)
  }, [activeTopicId, initialTopic, passive, setActiveTopicId])

  const activeTopic = useMemo<RendererTopic | undefined>(() => {
    if (passive) return undefined
    if (!activeTopicId) return pendingTopic
    const fromList = topics.find((t) => t.id === activeTopicId)
    if (fromList) return fromList
    if (pendingTopic?.id === activeTopicId) return pendingTopic
    return undefined
  }, [activeTopicId, passive, pendingTopic, topics])

  // Where the active topic resolved from. 'query' = persisted (in the DataApi
  // list); 'pending' = optimistic / temporary topic not yet persisted. Mirrors
  // `useActiveSession`'s `sessionSource` so callers can gate "last used" writes
  // to persisted topics only.
  const topicSource: ActiveTopicSource = useMemo(() => {
    if (!activeTopic) return 'none'
    if (topics.some((t) => t.id === activeTopic.id)) return 'query'
    if (pendingTopic?.id === activeTopic.id) return 'pending'
    return 'none'
  }, [activeTopic, pendingTopic, topics])

  const setActiveTopic = useCallback(
    (next: RendererTopic) => {
      if (passive) {
        setPendingTopic(next)
        return
      }
      setActiveTopicId(next.id)
      setPendingTopic(next)
    },
    [passive, setActiveTopicId]
  )

  useEffect(() => {
    if (passive) return
    if (activeTopic) {
      void EventEmitter.emit(EVENT_NAMES.CHANGE_TOPIC, activeTopic)
    }
  }, [activeTopic, passive])

  return { activeTopic, setActiveTopic, isLoading, topicSource }
}
