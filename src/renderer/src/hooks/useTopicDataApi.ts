/**
 * DataApi-backed topic queries and mutations for v2 chat flows.
 *
 * Prefer these when SQLite is the source of truth; legacy Redux/Dexie topic lists
 * can be merged or replaced incrementally.
 */

import { dataApiService } from '@data/DataApiService'
import { useSharedCache } from '@data/hooks/useCache'
import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { Topic as RendererTopic } from '@renderer/types'
import type { CreateTopicDto, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useTopicDataApi')

const EMPTY_API_TOPICS: readonly ApiTopic[] = Object.freeze([])
const EMPTY_RENDERER_TOPICS: readonly RendererTopic[] = Object.freeze([])

/**
 * Map a DataApi topic entity into the renderer {@link RendererTopic} shape.
 * Message history is not loaded here — use `useTopicMessagesV2` or `getTopicMessages`.
 */
export function mapApiTopicToRendererTopic(t: ApiTopic): RendererTopic {
  return {
    id: t.id,
    assistantId: t.assistantId ?? '',
    name: t.name ?? '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: [],
    pinned: t.isPinned,
    isNameManuallyEdited: t.isNameManuallyEdited
  }
}

/**
 * List topics for an assistant from SQLite via DataApi.
 */
export function useTopicsByAssistant(assistantId: string | undefined) {
  const { data, isLoading, error, refetch, mutate } = useQuery('/topics', {
    enabled: !!assistantId
  })

  const topics = useMemo(
    () => data?.filter((t) => t.assistantId === assistantId) ?? EMPTY_API_TOPICS,
    [data, assistantId]
  )
  const rendererTopics = useMemo(() => topics.map(mapApiTopicToRendererTopic), [topics])

  return {
    topics,
    rendererTopics,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * List all topics across all assistants from SQLite via DataApi.
 * Used by history / search pages that need the complete topic list.
 */
export function useAllTopics() {
  const { data, isLoading, error, refetch, mutate } = useQuery('/topics', {
    query: {}
  })

  const rendererTopics = useMemo(() => (data ? data.map(mapApiTopicToRendererTopic) : EMPTY_RENDERER_TOPICS), [data])

  return {
    topics: data ?? EMPTY_API_TOPICS,
    rendererTopics,
    isLoading,
    error,
    refetch,
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

  const rendererTopic = useMemo(() => (data ? mapApiTopicToRendererTopic(data) : undefined), [data])

  return {
    topic: data,
    rendererTopic,
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
    refresh: ({ args }) => ['/topics', `/topics/${args!.params.id}`]
  })

  const refreshTopics = useCallback(() => invalidate('/topics'), [invalidate])

  const createTopic = useCallback(
    async (dto: CreateTopicDto): Promise<ApiTopic> => {
      const topic = await createTrigger({ body: dto })
      logger.info('Created topic', { id: topic.id })
      return topic
    },
    [createTrigger]
  )

  const updateTopic = useCallback(
    async (topicId: string, dto: UpdateTopicDto): Promise<ApiTopic> => {
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

  const deleteAllTopics = useCallback(
    async (assistantId: string): Promise<void> => {
      const allTopics = await dataApiService.get('/topics')
      const assistantTopics = allTopics.filter((t) => t.assistantId === assistantId)
      await Promise.allSettled(assistantTopics.map((t) => dataApiService.delete(`/topics/${t.id}`)))
      await refreshTopics()
    },
    [refreshTopics]
  )

  const batchUpdateTopics = useCallback(
    async (topics: Array<{ id: string; dto: UpdateTopicDto }>): Promise<void> => {
      await Promise.allSettled(topics.map(({ id, dto }) => dataApiService.patch(`/topics/${id}`, { body: dto })))
      await refreshTopics()
    },
    [refreshTopics]
  )

  const moveTopic = useCallback(
    (topicId: string, toAssistantId: string): Promise<ApiTopic> => {
      return updateTopic(topicId, { assistantId: toAssistantId })
    },
    [updateTopic]
  )

  return {
    createTopic,
    updateTopic,
    deleteTopic,
    deleteAllTopics,
    batchUpdateTopics,
    moveTopic,
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
