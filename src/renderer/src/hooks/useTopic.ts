import db from '@renderer/databases'
import { deleteMessageFiles } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { Assistant, Topic } from '@renderer/types'
import { find } from 'lodash'
import { useEffect, useState } from 'react'

import { useAssistant } from './useAssistant'

let _activeTopic: Topic

export function useActiveTopic(_assistant: Assistant, topic?: Topic) {
  const { assistant } = useAssistant(_assistant.id)
  const [activeTopic, setActiveTopic] = useState(topic || _activeTopic || assistant?.topics[0])

  _activeTopic = activeTopic

  useEffect(() => {
    // activeTopic not in assistant.topics
    if (assistant && !find(assistant.topics, { id: activeTopic?.id })) {
      setActiveTopic(assistant.topics[0])
    }
  }, [activeTopic?.id, assistant])

  return { activeTopic, setActiveTopic }
}

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

export class TopicManager {
  static async getTopic(id: string) {
    return await db.topics.get(id)
  }

  static async getTopicMessages(id: string) {
    const topic = await this.getTopic(id)
    return topic ? topic.messages : []
  }

  static async removeTopic(id: string) {
    const messages = await this.getTopicMessages(id)

    for (const message of messages) {
      await deleteMessageFiles(message)
    }

    db.topics.delete(id)
  }

  static async clearTopicMessages(id: string) {
    const topic = await this.getTopic(id)

    if (topic) {
      for (const message of topic?.messages ?? []) {
        await deleteMessageFiles(message)
      }

      topic.messages = []

      await db.topics.update(id, topic)
    }
  }
}
