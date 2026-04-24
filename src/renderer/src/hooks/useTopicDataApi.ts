/**
 * DataApi-backed topic queries and mutations for v2 chat flows.
 *
 * Prefer these when SQLite is the source of truth; legacy Redux/Dexie topic lists
 * can be merged or replaced incrementally.
 */

import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { Topic as RendererTopic } from '@renderer/types'
import type { CreateTopicDto, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useEffect, useMemo } from 'react'

const logger = loggerService.withContext('useTopicDataApi')

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

  const topics = data?.filter((t) => t.assistantId === assistantId) ?? []
  const rendererTopics = topics.map(mapApiTopicToRendererTopic)

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

  return {
    topics: data ?? [],
    rendererTopics: data?.map(mapApiTopicToRendererTopic),
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
 *
 * Every mutation automatically invalidates the `/topics` SWR cache so
 * consumers like `useTopicsByAssistant` pick up changes.
 */
export function useTopicMutations() {
  const invalidate = useInvalidateCache()
  const { trigger: doCreate, isLoading: isCreating } = useMutation('POST', '/topics', {
    refresh: ['/topics']
  })

  const refreshTopics = useCallback(() => invalidate('/topics'), [invalidate])

  const createTopic = useCallback(
    async (dto: CreateTopicDto): Promise<ApiTopic> => {
      const topic = await doCreate({ body: dto })
      logger.info('Created topic', { id: topic.id })
      return topic
    },
    [doCreate]
  )

  const updateTopic = useCallback(
    async (topicId: string, dto: UpdateTopicDto): Promise<ApiTopic> => {
      const topic = await dataApiService.patch(`/topics/${topicId}`, { body: dto })
      await refreshTopics()
      logger.info('Updated topic', { id: topicId })
      return topic
    },
    [refreshTopics]
  )

  const deleteTopic = useCallback(
    async (topicId: string): Promise<void> => {
      await dataApiService.delete(`/topics/${topicId}`)
      await refreshTopics()
      logger.info('Deleted topic', { id: topicId })
    },
    [refreshTopics]
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
    async (topicId: string, toAssistantId: string): Promise<ApiTopic> => {
      const topic = await dataApiService.patch(`/topics/${topicId}`, { body: { assistantId: toAssistantId } })
      await refreshTopics()
      return topic
    },
    [refreshTopics]
  )

  return {
    createTopic,
    updateTopic,
    deleteTopic,
    deleteAllTopics,
    batchUpdateTopics,
    moveTopic,
    refreshTopics,
    isCreating
  }
}

/**
 * Listens for topic updates from the main process (e.g. auto-rename)
 * and invalidates the SWR topic cache so UI reflects the change.
 */
export function useTopicSync() {
  const invalidate = useInvalidateCache()
  const refresh = useCallback(() => {
    void invalidate('/topics')
  }, [invalidate])

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return

    const removeListener = window.electron.ipcRenderer.on(IpcChannel.Topic_Updated, refresh)

    return () => {
      removeListener()
    }
  }, [refresh])
}
