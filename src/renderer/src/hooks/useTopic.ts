import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { deleteMessageFiles } from '@renderer/services/MessagesService'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import {
  addTopic,
  removeAssistantTopicsThunk,
  removeTopicThunk,
  selectActiveTopic,
  selectTopicsByAssistantId,
  setActiveTopic,
  switchAssistant,
  updateTopic,
  updateTopics
} from '@renderer/store/topics'
import { Assistant, Topic } from '@renderer/types'
import { findMainTextBlocks } from '@renderer/utils/messageUtils/find'
import { isEmpty } from 'lodash'
import { useEffect } from 'react'

import { getStoreSetting } from './useSettings'

const renamingTopics = new Set<string>()

export function useActiveTopic() {
  const topics = useAppSelector((state) => state.topics.topics)
  const topic = useAppSelector(selectActiveTopic) || topics[0]
  const dispatch = useAppDispatch()

  useEffect(() => {
    dispatch(loadTopicMessagesThunk(topic.id))
  }, [topic, dispatch])

  return {
    activeTopic: topic,
    setActiveTopic: (topic: Topic) => dispatch(setActiveTopic(topic))
  }
}

export function useTopics() {
  const topics = useAppSelector((state) => state.topics.topics as Topic[])
  const dispatch = useAppDispatch()

  return {
    topics,
    addTopic: (topic: Topic, assistantId?: string) => {
      dispatch(addTopic({ topic, assistantId: assistantId || 'default' }))
    },
    removeTopic: (topic: Topic) => {
      dispatch(removeTopicThunk(topic.id))
    },
    removeAssistantTopics: (assistantId: string) => {
      dispatch(removeAssistantTopicsThunk(assistantId))
    },
    switchAssistant: (topic: Topic, toAssistant: Assistant) => {
      dispatch(switchAssistant({ topicId: topic.id, assistantId: toAssistant.id }))
    },
    updateTopic: (topic: Topic) => dispatch(updateTopic(topic)),
    updateTopics: (topics: Topic[]) => dispatch(updateTopics(topics))
  }
}

export function getTopic(assistant: Assistant, topicId: string) {
  const state = store.getState()
  const topics = selectTopicsByAssistantId(state, assistant.id)
  return topics.find((topic) => topic.id === topicId)
}

export async function getTopicById(topicId: string) {
  const state = store.getState()
  const topic = state.topics.topics.find((topic) => topic.id === topicId)
  const messages = await TopicManager.getTopicMessages(topicId)
  return { ...topic, messages } as Topic
}

export const autoRenameTopic = async (assistant: Assistant, topicId: string) => {
  if (renamingTopics.has(topicId)) {
    return
  }

  try {
    renamingTopics.add(topicId)

    const topic = await getTopicById(topicId)
    const enableTopicNaming = getStoreSetting('enableTopicNaming')

    if (isEmpty(topic.messages)) {
      return
    }

    if (topic.isNameManuallyEdited) {
      return
    }

    if (!enableTopicNaming) {
      const message = topic.messages[0]
      const blocks = findMainTextBlocks(message)
      const topicName = blocks
        .map((block) => block.content)
        .join('\n\n')
        .substring(0, 50)
      if (topicName) {
        const data = { ...topic, name: topicName } as Topic
        store.dispatch(setActiveTopic(data))
        store.dispatch(updateTopic(data))
      }
      return
    }

    if (topic && topic.name === i18n.t('chat.default.topic.name') && topic.messages.length >= 2) {
      const { fetchMessagesSummary } = await import('@renderer/services/ApiService')
      const summaryText = await fetchMessagesSummary({ messages: topic.messages, assistant })
      if (summaryText) {
        const data = { ...topic, name: summaryText }
        store.dispatch(setActiveTopic(data))
        store.dispatch(updateTopic(data))
      }
    }
  } finally {
    renamingTopics.delete(topicId)
  }
}

// Convert class to object with functions since class only has static methods
// 只有静态方法,没必要用class，可以export {}
export const TopicManager = {
  async getTopicLimit(limit: number) {
    return await db.topics
      .orderBy('updatedAt') // 按 updatedAt 排序（默认升序）
      .reverse() // 逆序（变成降序）
      .limit(limit) // 取前 10 条
      .toArray()
  },

  async getTopic(id: string) {
    return await db.topics.get(id)
  },

  async getAllTopics() {
    return await db.topics.toArray()
  },

  async getTopicMessages(id: string) {
    const topic = await TopicManager.getTopic(id)
    return topic ? topic.messages : []
  },

  async removeTopic(id: string) {
    const messages = await TopicManager.getTopicMessages(id)

    for (const message of messages) {
      await deleteMessageFiles(message)
    }

    db.topics.delete(id)
  },

  async clearTopicMessages(id: string) {
    const topic = await TopicManager.getTopic(id)

    if (topic) {
      for (const message of topic?.messages ?? []) {
        await deleteMessageFiles(message)
      }

      topic.messages = []

      await db.topics.update(id, topic)
    }
  }
}
