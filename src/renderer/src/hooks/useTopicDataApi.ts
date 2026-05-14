/**
 * DataApi-backed topic queries and mutations for v2 chat flows.
 *
 * Returns the canonical {@link Topic} entity straight from SQLite. The
 * transitional {@link mapApiTopicToRendererTopic} helper bridges to the v1
 * renderer shape for callers that haven't migrated yet — it'll be removed
 * once Phase 2 finishes.
 */

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
import type { Topic as RendererTopic } from '@renderer/types'
import type { CreateTopicDto, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic } from '@shared/data/types/topic'
import { useCallback, useEffect, useRef } from 'react'

const logger = loggerService.withContext('useTopicDataApi')

const EMPTY_TOPICS: readonly Topic[] = Object.freeze([])

/**
 * Map a DataApi topic entity into the renderer {@link RendererTopic} shape.
 * Message history is not loaded here — use `useTopicMessages` or `getTopicMessages`.
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
