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
import { registerDataApiCursorResource } from '@data/hooks/useDataApiCursorRevision'
import { loggerService } from '@logger'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { MessageExportView } from '@renderer/types/messageExport'
import type { Topic as RendererTopic } from '@renderer/types/topic'
import { ErrorCode } from '@shared/data/api/errors'
import type {
  CreateTopicDto,
  DeleteTopicsResult,
  TopicListItem,
  TopicSortBy,
  TopicStatsQuery,
  UpdateTopicDto
} from '@shared/data/api/schemas/topics'
import { type BranchMessagesResponse, type Message as SharedMessage, toContentRole } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useTopic')

// '/topics' is cursor-paged: a local write restarts its cursor chains from
// page one, and every list refresh also refetches the '/topics/stats' facts.
registerDataApiCursorResource('/topics', { linkedRefreshPaths: ['/topics/stats'] })

// ─── Tier 1: pure / non-React helpers ─────────────────────────────────────

const EMPTY_TOPICS: readonly TopicListItem[] = Object.freeze([])
const DEFAULT_TOPIC_PAGE_SIZE = 50

/**
 * Map a DataApi topic entity into the renderer {@link RendererTopic} shape.
 * Message history is not loaded here — use `useTopicMessagesV2` or `getTopicMessages`.
 *
 * Pin state is no longer a topic column. Collection callers overlay the fixed
 * `TopicListItem` pin projection; by-id callers receive a pure entity, so the
 * legacy `pinned` flag remains `false` in this adapter.
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
    activeNodeId: t.activeNodeId,
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
    // Carry the frozen author so export headers survive assistant/agent rename/delete.
    ...(shared.messageSnapshot && { messageSnapshot: shared.messageSnapshot }),
    ...(shared.stats && { stats: shared.stats })
  }
}

// ─── Tier 2: raw DataApi queries/mutations ────────────────────────────────

/**
 * List topics across all assistants from SQLite via DataApi.
 *
 * Backed by `useInfiniteQuery` cursor pagination. Without `sortBy`, `/topics`
 * returns the legacy server-composed view (pinned topics first via the `pin`
 * table, then unpinned ordered by `topic.orderKey`). With `sortBy` (D1 of
 * #16890) the response is a flat stream — `'createdAt'` for immutable creation
 * order, `'updatedAt'` for activity order, or `'orderKey'` for manual order.
 * Pin state selects a band and composes with the same business ordering; the
 * `assistantId` owner scope (`uuid | 'unlinked'`) also applies. Consumers page
 * explicitly with `loadNext()`.
 *
 * `q` triggers server-side LIKE search on `topic.name` in both modes.
 */
export function useTopics(opts?: {
  q?: string
  sortBy?: TopicSortBy
  assistantId?: string
  pinned?: boolean
  pageSize?: number
  enabled?: boolean
}) {
  const q = opts?.q?.trim()
  const query = useMemo(() => {
    const built: { q?: string; sortBy?: TopicSortBy; assistantId?: string; pinned?: boolean } = {}
    if (q) built.q = q
    if (opts?.sortBy) built.sortBy = opts.sortBy
    if (opts?.sortBy && opts?.assistantId) built.assistantId = opts.assistantId
    if (opts?.sortBy && opts?.pinned !== undefined) built.pinned = opts.pinned
    return Object.keys(built).length > 0 ? built : undefined
  }, [q, opts?.sortBy, opts?.assistantId, opts?.pinned])
  const pageSize = opts?.pageSize ?? DEFAULT_TOPIC_PAGE_SIZE
  const continuityKey = useMemo(
    () =>
      JSON.stringify({
        assistantId: opts?.assistantId,
        mode: opts?.sortBy ? 'flat' : 'legacy',
        pinned: opts?.pinned,
        q
      }),
    [opts?.assistantId, opts?.pinned, opts?.sortBy, q]
  )
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh, mutate } = useInfiniteQuery('/topics', {
    continuityKey,
    query,
    limit: pageSize,
    enabled: opts?.enabled,
    resetOnLocalWrite: '/topics'
  })
  const topics = useInfiniteFlatItems(pages)
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
 * Factual topic aggregation from `GET /topics/stats` (D3 of #16890): totals,
 * pinned counts, and a per-assistant breakdown whose `assistantId: null`
 * entry represents unlinked topics. Local list mutations refetch it through
 * the ordinary DataApi cache refresh path.
 */
export function useTopicStats(opts?: { enabled?: boolean; query?: TopicStatsQuery }) {
  const { data, isLoading, error, refetch } = useQuery('/topics/stats', {
    enabled: opts?.enabled,
    query: opts?.query
  })

  return { stats: data, isLoading, error, refetch }
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
 * The globally most-recently-updated topic, for first-entry restore.
 *
 * Backed by a dedicated `updatedAt DESC LIMIT 1` server query, so it resumes the
 * last-touched conversation without waiting for the full topic history to
 * paginate in and without depending on the pinned-first `/topics` list order.
 *
 * `/topics/latest` is a global MAX(updatedAt) aggregate, so keeping its cache
 * coherent would mean every updatedAt-bumping write invalidating it (an
 * unbounded fan-out). It's read-on-demand instead: the first-entry effect reads
 * it once on mount, and folding `isRefreshing` into `isLoading` makes that read
 * wait for the on-mount revalidation to settle rather than trust a stale cache.
 * `latestTopic` is `undefined` while loading and when the library is empty.
 */
export function useLatestTopic(opts?: { enabled?: boolean }) {
  const { data, isLoading, isRefreshing, refetch, mutate } = useQuery('/topics/latest', { enabled: opts?.enabled })

  return {
    latestTopic: data?.topic ?? undefined,
    isLoading: isLoading || isRefreshing,
    refetch,
    mutate
  }
}

/**
 * Topic mutations (create / update / delete) backed by DataApi.
 */
export function useTopicMutations() {
  const invalidate = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()

  const { trigger: createTrigger, isLoading: isCreating } = useMutation('POST', '/topics', {
    refresh: ['/topics']
  })
  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', '/topics/:id', {
    refresh: ({ args }) => ['/topics', `/topics/${args!.params.id}`]
  })
  const { trigger: deleteTrigger, isLoading: isDeleting } = useMutation('DELETE', '/topics/:id', {
    // After delete, only invalidate the list — refreshing `/topics/:id` would
    // trigger a fetch that 404s and caches an error in SWR.
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
      closeConversationTabs('assistants', [topicId])
      logger.info('Deleted topic', { id: topicId })
    },
    [closeConversationTabs, deleteTrigger]
  )

  const deleteTopics = useCallback(
    async (ids: string[]): Promise<DeleteTopicsResult> => {
      const result = await deleteManyTrigger({ query: { ids: ids.join(',') } })
      closeConversationTabs('assistants', result.deletedIds)
      logger.info('Deleted topics', { count: result.deletedCount })
      return result
    },
    [closeConversationTabs, deleteManyTrigger]
  )

  const deleteTopicsByAssistantId = useCallback(
    async (assistantId: string): Promise<DeleteTopicsResult> => {
      const result = await deleteByAssistantTrigger({ params: { assistantId } })
      closeConversationTabs('assistants', result.deletedIds)
      logger.info('Deleted assistant topics', { assistantId, count: result.deletedCount })
      return result
    },
    [closeConversationTabs, deleteByAssistantTrigger]
  )

  const batchUpdateTopics = useCallback(
    async (topics: Array<{ id: string; dto: UpdateTopicDto }>) => {
      const results = await Promise.allSettled(
        topics.map(({ id, dto }) => dataApiService.patch(`/topics/${id}`, { body: dto }))
      )
      await refreshTopics()
      return results
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
 * Listens for `ai.topic_auto_renamed` and invalidates the renamed
 * topic's SWR cache so the new name shows up without manual refetch.
 */
export function useTopicAutoRenameSync() {
  const invalidate = useInvalidateCache()

  useIpcOn('ai.topic_auto_renamed', ({ topicId }) => void invalidate(['/topics', `/topics/${topicId}`]))
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
  // Resolve the active topic by id (like `useActiveSession`) so first-entry restore
  // paints from `/latest` immediately; this hook only needs the one active row.
  const { topic: apiActiveTopic, isLoading: isActiveTopicQueryLoading } = useTopicById(
    passive || !activeTopicId ? undefined : activeTopicId
  )
  const queryTopic = useMemo<RendererTopic | undefined>(
    () =>
      activeTopicId && apiActiveTopic?.id === activeTopicId ? mapApiTopicToRendererTopic(apiActiveTopic) : undefined,
    [activeTopicId, apiActiveTopic]
  )
  // Holds the last Topic object passed to setActiveTopic, used as fallback while the
  // by-id query for the newly-selected topic is still resolving.
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
    if (queryTopic) return queryTopic
    if (pendingTopic?.id === activeTopicId) return pendingTopic
    return undefined
  }, [activeTopicId, passive, pendingTopic, queryTopic])

  // Where the active topic resolved from. 'query' = persisted (fetched by id);
  // 'pending' = optimistic / temporary topic not yet persisted. Mirrors
  // `useActiveSession`'s `sessionSource` so callers can gate "last used" writes
  // to persisted topics only.
  const topicSource: ActiveTopicSource = useMemo(() => {
    if (!activeTopic) return 'none'
    if (queryTopic?.id === activeTopic.id) return 'query'
    if (pendingTopic?.id === activeTopic.id) return 'pending'
    return 'none'
  }, [activeTopic, pendingTopic, queryTopic])

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

  // Clear the active topic entirely. Both `activeTopicId` and the in-memory `pendingTopic`
  // fallback must be reset, otherwise `activeTopic` would keep resolving to the stale pending
  // object. Used by post-delete replacement paths that must not strand the view on a topic that
  // was just deleted when creating its replacement fails.
  const clearActiveTopic = useCallback(() => {
    setPendingTopic(undefined)
    if (!passive) setActiveTopicId(null)
  }, [passive, setActiveTopicId])

  useEffect(() => {
    if (passive) return
    if (activeTopic) {
      void EventEmitter.emit(EVENT_NAMES.CHANGE_TOPIC, activeTopic)
    }
  }, [activeTopic, passive])

  // Mirror `useActiveSession`: once the topic resolves (from the by-id query or the
  // pending fallback) we are no longer loading, even while a background revalidation runs.
  const isLoading = !activeTopic && isActiveTopicQueryLoading
  return { activeTopic, setActiveTopic, clearActiveTopic, isLoading, topicSource }
}
