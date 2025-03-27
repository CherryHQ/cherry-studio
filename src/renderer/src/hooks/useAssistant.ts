import { db } from '@renderer/databases'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistant,
  addGroup,
  addTopic,
  removeAllTopics,
  removeAssistant,
  removeGroup,
  removeTopic,
  setModel,
  updateAssistant,
  updateAssistantGroup,
  updateAssistants,
  updateAssistantSettings,
  updateDefaultAssistant,
  updateGroup,
  updateGroupsOrder,
  updateTopic,
  updateTopics
} from '@renderer/store/assistants'
import { setDefaultModel, setTopicNamingModel, setTranslateModel } from '@renderer/store/llm'
import { Assistant, AssistantGroup, AssistantSettings, Model, Topic } from '@renderer/types'
import { findIndex } from 'lodash'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'

import { TopicManager } from './useTopic'

export function useAssistants() {
  const { assistants } = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()

  return {
    assistants,
    updateAssistants: (assistants: Assistant[]) => dispatch(updateAssistants(assistants)),
    addAssistant: (assistant: Assistant) => dispatch(addAssistant(assistant)),
    removeAssistant: (id: string) => {
      dispatch(removeAssistant({ id }))
      const assistant = assistants.find((a) => a.id === id)
      const topics = assistant?.topics || []
      topics.forEach(({ id }) => TopicManager.removeTopic(id))
    },
    addGroup: (group: AssistantGroup) => dispatch(addGroup(group)),
    updateGroup: (group: AssistantGroup) => dispatch(updateGroup(group)),
    removeGroup: (groupId: string) => dispatch(removeGroup(groupId)),
    updateAssistantGroup: (assistantId: string, groupId?: string) =>
      dispatch(updateAssistantGroup({ assistantId, groupId })),
    updateGroupsOrder: (groups: AssistantGroup[]) => dispatch(updateGroupsOrder(groups))
  }
}

export function useAssistant(assistantId: string) {
  console.log('useAssistant钩子运行, assistantId:', assistantId)

  const assistants = useAppSelector((state) => state.assistants.assistants)
  console.log('从store获取到assistants, 数量:', assistants?.length)

  const assistant = assistants.find((c) => c.id === assistantId) as Assistant
  console.log('找到匹配的assistant:', assistant?.id)

  const dispatch = useAppDispatch()
  const { defaultModel } = useDefaultModel()
  const { t } = useTranslation()
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null)

  return {
    assistant,
    model: assistant?.model || defaultModel,
    addTopic: (topic: Topic) => dispatch(addTopic({ assistantId: assistant?.id || assistantId, topic })),
    removeTopic: (topic: Topic) => {
      window.modal.confirm({
        title: t('topic.delete.title'),
        content: t('topic.delete.content'),
        okButtonProps: { danger: true },
        centered: true,
        onOk: () => {
          if (topic.id === activeTopicId) {
            const index = findIndex(assistant?.topics, { id: topic.id })
            const newTopic = assistant?.topics[index === 0 ? 1 : index - 1]
            newTopic && setActiveTopicId(newTopic.id)
          }
          dispatch(removeTopic({ assistantId: assistant?.id || assistantId, topic }))
        }
      })
    },
    duplicateTopic: (topic: Topic) => {
      const newTopic = {
        ...topic,
        id: uuid(),
        name: `${topic.name} ${t('topic.copy')}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      dispatch(addTopic({ assistantId: assistant?.id || assistantId, topic: newTopic }))
      return newTopic
    },
    moveTopic: (topic: Topic, toAssistant: Assistant) => {
      dispatch(addTopic({ assistantId: toAssistant.id, topic: { ...topic, assistantId: toAssistant.id } }))
      dispatch(removeTopic({ assistantId: assistant.id, topic }))
      // update topic messages in database
      db.topics
        .where('id')
        .equals(topic.id)
        .modify((dbTopic) => {
          if (dbTopic.messages) {
            dbTopic.messages = dbTopic.messages.map((message) => ({
              ...message,
              assistantId: toAssistant.id
            }))
          }
        })
    },
    updateTopic: (topic: Topic) => dispatch(updateTopic({ assistantId: assistant.id, topic })),
    updateTopics: (topics: Topic[]) => dispatch(updateTopics({ assistantId: assistant.id, topics })),
    removeAllTopics: () => dispatch(removeAllTopics({ assistantId: assistant.id })),
    setModel: (model: Model) => dispatch(setModel({ assistantId: assistant.id, model })),
    updateAssistant: (assistant: Assistant) => dispatch(updateAssistant(assistant)),
    updateAssistantSettings: (settings: Partial<AssistantSettings>) => {
      dispatch(updateAssistantSettings({ assistantId: assistant.id, settings }))
    }
  }
}

export function useDefaultAssistant() {
  const defaultAssistant = useAppSelector((state) => state.assistants.defaultAssistant)
  const dispatch = useAppDispatch()

  return {
    defaultAssistant: {
      ...defaultAssistant,
      topics: [getDefaultTopic(defaultAssistant.id)]
    },
    updateDefaultAssistant: (assistant: Assistant) => dispatch(updateDefaultAssistant({ assistant }))
  }
}

export function useDefaultModel() {
  const { defaultModel, topicNamingModel, translateModel } = useAppSelector((state) => state.llm)
  const dispatch = useAppDispatch()

  return {
    defaultModel,
    topicNamingModel,
    translateModel,
    setDefaultModel: (model: Model) => dispatch(setDefaultModel({ model })),
    setTopicNamingModel: (model: Model) => dispatch(setTopicNamingModel({ model })),
    setTranslateModel: (model: Model) => dispatch(setTranslateModel({ model }))
  }
}
