import i18n from '@renderer/i18n'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import store from '@renderer/store'
import { updateTopic } from '@renderer/store/assistants'
import { setNewlyRenamedTopics, setRenamingTopics } from '@renderer/store/runtime'
import { TopicManager } from '@renderer/store/thunk/topicManager'
import type { Assistant, Topic } from '@renderer/types'
import { findMainTextBlocks } from '@renderer/utils/messageUtils/find'
import { isEmpty } from 'lodash'

import { _activeTopic, _setActiveTopic } from './useActiveTopic'
import { getStoreSetting } from './useSettings'

// const logger = loggerService.withContext('useTopic')

export function useTopic(assistant: Assistant, topicId?: string) {
  return assistant?.topics.find((topic) => topic.id === topicId)
}

export function getTopic(assistant: Assistant, topicId: string) {
  return assistant?.topics.find((topic) => topic.id === topicId)
}

export async function getTopicById(topicId: string) {
  const assistants = store.getState().assistants.assistants
  const topics = assistants.map((assistant) => assistant.topics).flat()
  const topic = topics.find((topic) => topic.id === topicId)
  const messages = await TopicManager.getTopicMessages(topicId)
  return { ...topic, messages } as Topic
}

/**
 * 开始重命名指定话题
 */
export const startTopicRenaming = (topicId: string) => {
  const currentIds = store.getState().runtime.chat.renamingTopics
  if (!currentIds.includes(topicId)) {
    store.dispatch(setRenamingTopics([...currentIds, topicId]))
  }
}

/**
 * 完成重命名指定话题
 */
export const finishTopicRenaming = (topicId: string) => {
  const state = store.getState()

  // 1. 立即从 renamingTopics 移除
  const currentRenaming = state.runtime.chat.renamingTopics
  store.dispatch(setRenamingTopics(currentRenaming.filter((id) => id !== topicId)))

  // 2. 立即添加到 newlyRenamedTopics
  const currentNewlyRenamed = state.runtime.chat.newlyRenamedTopics
  store.dispatch(setNewlyRenamedTopics([...currentNewlyRenamed, topicId]))

  // 3. 延迟从 newlyRenamedTopics 移除
  setTimeout(() => {
    const current = store.getState().runtime.chat.newlyRenamedTopics
    store.dispatch(setNewlyRenamedTopics(current.filter((id) => id !== topicId)))
  }, 700)
}

const topicRenamingLocks = new Set<string>()

export const autoRenameTopic = async (assistant: Assistant, topicId: string) => {
  if (topicRenamingLocks.has(topicId)) {
    return
  }

  try {
    topicRenamingLocks.add(topicId)

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
        try {
          startTopicRenaming(topicId)

          const data = { ...topic, name: topicName } as Topic
          topic.id === _activeTopic.id && _setActiveTopic(data)
          store.dispatch(updateTopic({ assistantId: assistant.id, topic: data }))
        } finally {
          finishTopicRenaming(topicId)
        }
      }
      return
    }

    if (topic && topic.name === i18n.t('chat.default.topic.name') && topic.messages.length >= 2) {
      try {
        startTopicRenaming(topicId)
        const summaryText = await fetchMessagesSummary({ messages: topic.messages, assistant })
        if (summaryText) {
          const data = { ...topic, name: summaryText }
          topic.id === _activeTopic.id && _setActiveTopic(data)
          store.dispatch(updateTopic({ assistantId: assistant.id, topic: data }))
        }
      } finally {
        finishTopicRenaming(topicId)
      }
    }
  } finally {
    topicRenamingLocks.delete(topicId)
  }
}
