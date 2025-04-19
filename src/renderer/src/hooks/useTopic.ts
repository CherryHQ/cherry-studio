import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { deleteMessageFiles } from '@renderer/services/MessagesService'
import store, { useAppDispatch } from '@renderer/store'
import { updateTopic } from '@renderer/store/assistants'
import { prepareTopicMessages, removeTemporaryTopicState } from '@renderer/store/messages'
import { Assistant, Topic } from '@renderer/types'
import { find, isEmpty } from 'lodash'
import { useCallback, useEffect, useState } from 'react'

import { useAssistant } from './useAssistant'
import { getStoreSetting } from './useSettings'

const renamingTopics = new Set<string>()

let _activeTopic: Topic | null = null
let _setActiveTopic: (topic: Topic | null) => void = () => {}

export function useActiveTopic(_assistant: Assistant, initialTopic?: Topic) {
  const { assistant } = useAssistant(_assistant.id)
  const dispatch = useAppDispatch()
  const [activeTopic, _setActiveTopicInternal] = useState<Topic | null>(
    initialTopic || _activeTopic || assistant?.topics[0] || null
  )

  _activeTopic = activeTopic

  const setActiveTopic = useCallback(
    (newTopic: Topic | null) => {
      // Check if current activeTopic (before update) is temporary
      if (_activeTopic && _activeTopic.isTemporary && _activeTopic.id !== newTopic?.id) {
        dispatch(removeTemporaryTopicState(_activeTopic.id))
      }
      _setActiveTopicInternal(newTopic)
      _activeTopic = newTopic
    },
    [dispatch]
  )

  _setActiveTopic = setActiveTopic

  useEffect(() => {
    if (activeTopic) {
      store.dispatch(prepareTopicMessages(activeTopic))
    }
  }, [activeTopic])

  useEffect(() => {
    if (activeTopic?.isTemporary) {
      return
    }
    // activeTopic not in assistant.topics (and not temporary)
    if (assistant && !find(assistant.topics, { id: activeTopic?.id })) {
      // Fallback to the first topic in the assistant's list
      setActiveTopic(assistant.topics[0] || null)
    }
  }, [activeTopic, assistant, setActiveTopic])

  return { activeTopic, setActiveTopic }
}

export function useTopic(assistant: Assistant, topicId?: string) {
  if (topicId?.startsWith('_temp-')) return undefined
  return assistant?.topics.find((topic) => topic.id === topicId)
}

export function getTopic(assistant: Assistant, topicId: string) {
  if (topicId?.startsWith('_temp-')) return undefined
  return assistant?.topics.find((topic) => topic.id === topicId)
}

export async function getTopicById(topicId: string) {
  if (topicId?.startsWith('_temp-')) {
    const currentTopic = store.getState().messages.currentTopic
    if (currentTopic && currentTopic.id === topicId && currentTopic.isTemporary) {
      const messages = store.getState().messages.messagesByTopic[topicId] || []
      return { ...currentTopic, messages }
    }
    return undefined
  }

  const assistants = store.getState().assistants.assistants
  const topics = assistants.map((assistant) => assistant.topics).flat()
  const topic = topics.find((topic) => topic.id === topicId)
  const messages = await TopicManager.getTopicMessages(topicId)
  return topic ? ({ ...topic, messages } as Topic) : undefined
}

export const autoRenameTopic = async (assistant: Assistant, topicId: string) => {
  if (topicId?.startsWith('_temp-')) {
    return
  }

  if (renamingTopics.has(topicId)) {
    return
  }

  try {
    renamingTopics.add(topicId)

    const topic = await getTopicById(topicId)
    const enableTopicNaming = getStoreSetting('enableTopicNaming')

    if (!topic || isEmpty(topic.messages)) {
      return
    }

    if (topic.isTemporary) {
      return
    }

    if (topic.isNameManuallyEdited) {
      return
    }

    if (!enableTopicNaming) {
      const topicName = topic.messages[0]?.content.substring(0, 50)
      if (topicName) {
        const data = { ...topic, name: topicName } as Topic
        _setActiveTopic(data)
        store.dispatch(updateTopic({ assistantId: assistant.id, topic: data }))
      }
      return
    }

    if (topic && topic.name === i18n.t('chat.default.topic.name') && topic.messages.length >= 2) {
      const { fetchMessagesSummary } = await import('@renderer/services/ApiService')
      const summaryText = await fetchMessagesSummary({ messages: topic.messages, assistant })
      if (summaryText) {
        const data = { ...topic, name: summaryText }
        _setActiveTopic(data)
        store.dispatch(updateTopic({ assistantId: assistant.id, topic: data }))
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
    if (id?.startsWith('_temp-')) return undefined
    return await db.topics.get(id)
  },

  async getAllTopics() {
    return await db.topics.toArray()
  },

  async getTopicMessages(id: string) {
    if (id?.startsWith('_temp-')) {
      return store.getState().messages.messagesByTopic[id] || []
    }
    // For persistent topics, get from DB
    const topic = await TopicManager.getTopic(id)
    return topic ? topic.messages : []
  },

  async removeTopic(id: string) {
    if (id?.startsWith('_temp-')) return
    // For persistent topics, remove messages and the topic entry from DB
    const messages = await TopicManager.getTopicMessages(id)

    for (const message of messages) {
      await deleteMessageFiles(message)
    }

    db.topics.delete(id)
  },

  async clearTopicMessages(id: string) {
    if (id?.startsWith('_temp-')) return
    // For persistent topics, clear messages in DB
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
