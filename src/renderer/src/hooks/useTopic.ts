import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { mapApiTopicToRendererTopic, useAllTopics } from '@renderer/hooks/useTopicDataApi'
import { fetchMessagesFromDataApi } from '@renderer/services/db/DataApiMessageDataSource'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { upsertManyBlocks } from '@renderer/store/messageBlock'
import type { Message, Topic } from '@renderer/types'
import { useCallback, useEffect, useMemo, useState } from 'react'

let _activeTopicId: string | undefined

/**
 * Manages the currently-selected topic across the home page.
 * Keeps a transient `pendingTopic` for optimistic creation so SWR-refresh
 * delays don't bounce the UI back to an old topic.
 */
export function useActiveTopic(topic?: Topic) {
  const { topics: apiTopics, isLoading } = useAllTopics({ loadAll: true })
  const topics = useMemo(() => apiTopics.map(mapApiTopicToRendererTopic), [apiTopics])
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(topic?.id ?? _activeTopicId)
  // Holds the last Topic object passed to setActiveTopic, used as fallback when
  // the newly-added topic is not yet in `topics` (SWR still refetching).
  const [pendingTopic, setPendingTopic] = useState<Topic | undefined>(topic)

  const activeTopic = useMemo<Topic | undefined>(() => {
    if (!activeTopicId) return pendingTopic ?? topics[0]
    const fromList = topics.find((t) => t.id === activeTopicId)
    if (fromList) return fromList
    if (pendingTopic?.id === activeTopicId) return pendingTopic
    return undefined
  }, [activeTopicId, topics, pendingTopic])

  _activeTopicId = activeTopicId

  const setActiveTopic = useCallback((next: Topic) => {
    setActiveTopicId((prev) => (prev === next.id ? prev : next.id))
    setPendingTopic(next)
  }, [])

  // When no topic is selected yet and the list has loaded, pick the first one
  useEffect(() => {
    if (!activeTopicId && topics.length > 0) {
      setActiveTopicId(topics[0].id)
    }
  }, [activeTopicId, topics])

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

/**
 * Load and return all messages for a topic.
 *
 * Fetches directly from DataApi (SQLite) and hydrates the renderer's
 * message-blocks Redux slice so downstream `findAllBlocks` /
 * `getMainTextContent` keep working without extra wiring.
 *
 * Used by one-off consumers (export, knowledge analysis, topic rename
 * pre-check). The main chat UI reads messages via `useTopicMessagesV2`.
 */
export async function getTopicMessages(id: string): Promise<Message[]> {
  const { messages, blocks } = await fetchMessagesFromDataApi(id)
  if (blocks.length > 0) {
    store.dispatch(upsertManyBlocks(blocks))
  }
  return messages
}
