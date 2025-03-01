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
  updateTopic,
  updateTopics
} from '@renderer/store/assistants'
import { setDefaultModel, setTopicNamingModel, setTranslateModel } from '@renderer/store/llm'
import { Assistant, AssistantGroup, AssistantSettings, Model, Topic } from '@renderer/types'
import { safeFilter } from '@renderer/utils/safeArrayUtils'

import { TopicManager } from './useTopic'

export function useAssistants() {
  const assistantsState = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()

  // 确保返回的数组始终是有效的，即使Redux状态为空
  const safeAssistants = assistantsState?.assistants || []
  const safeGroups = assistantsState?.groups || []

  return {
    assistants: safeAssistants,
    groups: safeGroups,
    updateAssistants: (assistants: Assistant[]) => dispatch(updateAssistants(assistants)),
    addAssistant: (assistant: Assistant) => dispatch(addAssistant(assistant)),
    removeAssistant: (id: string) => {
      dispatch(removeAssistant({ id }))
      const assistant = safeFilter(safeAssistants, (a) => a.id === id)[0]
      const topics = assistant?.topics || []
      topics.forEach(({ id }) => TopicManager.removeTopic(id))
    },
    addGroup: (group: AssistantGroup) => dispatch(addGroup(group)),
    updateGroup: (group: AssistantGroup) => dispatch(updateGroup(group)),
    removeGroup: (id: string) => dispatch(removeGroup({ id })),
    updateAssistantGroup: (assistantId: string, groupId?: string) =>
      dispatch(updateAssistantGroup({ assistantId, groupId }))
  }
}

export function useAssistant(id: string) {
  const assistantsState = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()
  const { defaultModel } = useDefaultModel()

  // 安全地获取助手对象，如果不存在返回一个带有默认值的对象
  const safeAssistants = assistantsState?.assistants || []
  const assistant = safeFilter(safeAssistants, (a) => a.id === id)[0] || {
    id: '',
    topics: [],
    model: defaultModel,
    defaultModel: defaultModel // 添加defaultModel属性以匹配类型
  }

  return {
    assistant,
    model: assistant?.model ?? assistant?.defaultModel ?? defaultModel,
    addTopic: (topic: Topic) => {
      if (!assistant || !assistant.id) return
      dispatch(addTopic({ assistantId: assistant.id, topic }))
    },
    removeTopic: (topic: Topic) => {
      if (!assistant || !assistant.id) return
      TopicManager.removeTopic(topic.id)
      dispatch(removeTopic({ assistantId: assistant.id, topic }))
    },
    moveTopic: (topic: Topic, toAssistant: Assistant) => {
      if (!assistant || !assistant.id || !toAssistant || !toAssistant.id) return
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
    updateTopic: (topic: Topic) => {
      if (!assistant || !assistant.id) return
      dispatch(updateTopic({ assistantId: assistant.id, topic }))
    },
    updateTopics: (topics: Topic[]) => {
      if (!assistant || !assistant.id) return
      dispatch(updateTopics({ assistantId: assistant.id, topics }))
    },
    removeAllTopics: () => {
      if (!assistant || !assistant.id) return
      dispatch(removeAllTopics({ assistantId: assistant.id }))
    },
    setModel: (model: Model) => {
      if (!assistant || !assistant.id) return
      dispatch(setModel({ assistantId: assistant.id, model }))
    },
    updateAssistant: (assistant: Assistant) => {
      if (!assistant || !assistant.id) return
      dispatch(updateAssistant(assistant))
    },
    updateAssistantSettings: (settings: Partial<AssistantSettings>) => {
      if (!assistant || !assistant.id) return
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
