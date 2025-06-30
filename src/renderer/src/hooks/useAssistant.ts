import { db } from '@renderer/databases'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistant,
  createAssistantFromTemplate,
  removeAssistant,
  selectActiveAssistants,
  selectTemplates,
  setModel,
  updateAssistant,
  updateAssistants,
  updateAssistantSettings,
  updateDefaultAssistant
} from '@renderer/store/assistants'
import { setDefaultModel, setTopicNamingModel, setTranslateModel } from '@renderer/store/llm'
import { selectTopicsForAssistant, topicsActions } from '@renderer/store/topics'
import { Assistant, AssistantSettings, Model, Topic } from '@renderer/types'
import { useCallback, useMemo } from 'react'

export function useAssistants() {
  const assistants = useAppSelector(selectActiveAssistants)
  const templates = useAppSelector(selectTemplates)
  const dispatch = useAppDispatch()

  const getAssistantById = useCallback((id: string) => assistants.find((a) => a.id === id), [assistants])

  return {
    assistants,
    templates,
    getAssistantById,
    updateAssistants: (assistants: Assistant[]) => dispatch(updateAssistants(assistants)),
    addAssistant: (assistant: Assistant) => {
      dispatch(addAssistant({ ...assistant, isTemplate: false }))
      dispatch(topicsActions.addDefaultTopic({ assistantId: assistant.id }))
    },
    addTemplate: (template: Assistant) => {
      dispatch(addAssistant({ ...template, isTemplate: true }))
    },
    removeAssistant: (id: string) => {
      dispatch(removeAssistant({ id }))
      // Remove all topics for this assistant
      dispatch(topicsActions.removeAllTopics({ assistantId: id }))
    },
    createAssistantFromTemplate: (templateId: string, assistantId: string) => {
      dispatch(createAssistantFromTemplate({ templateId, assistantId }))
      dispatch(topicsActions.addDefaultTopic({ assistantId }))
    }
  }
}

export function useAssistant(id: string) {
  const assistant = useAppSelector((state) => state.assistants.assistants.find((a) => a.id === id) as Assistant)
  const topics = useTopicsForAssistant(id)
  const dispatch = useAppDispatch()
  const { defaultModel } = useDefaultModel()

  const model = useMemo(() => assistant?.model ?? assistant?.defaultModel ?? defaultModel, [assistant, defaultModel])
  if (!model) {
    throw new Error(`Assistant model is not set for assistant with name: ${assistant?.name ?? 'unknown'}`)
  }

  const assistantWithModel = useMemo(() => ({ ...assistant, model, topics }), [assistant, model, topics])

  return {
    assistant: assistantWithModel,
    model,
    topics,
    addTopic: (topic: Topic) => dispatch(topicsActions.addTopic({ assistantId: id, topic })),
    removeTopic: (topic: Topic) => {
      dispatch(topicsActions.removeTopic({ assistantId: id, topicId: topic.id }))
    },
    moveTopic: (topic: Topic, toAssistant: Assistant) => {
      dispatch(topicsActions.moveTopic({ fromAssistantId: id, toAssistantId: toAssistant.id, topicId: topic.id }))
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
    updateTopic: (topic: Topic) => dispatch(topicsActions.updateTopic({ assistantId: id, topic })),
    updateTopics: (topics: Topic[]) => dispatch(topicsActions.updateTopics({ assistantId: id, topics })),
    removeAllTopics: () => dispatch(topicsActions.removeAllTopics({ assistantId: id })),
    setModel: useCallback(
      (model: Model) => assistant && dispatch(setModel({ assistantId: assistant?.id, model })),
      [assistant, dispatch]
    ),
    updateAssistant: (assistant: Assistant) => dispatch(updateAssistant(assistant)),
    updateAssistantSettings: (settings: Partial<AssistantSettings>) => {
      dispatch(updateAssistantSettings({ assistantId: assistant.id, settings }))
    }
  }
}

export function useTopicsForAssistant(assistantId: string) {
  return useAppSelector((state) => selectTopicsForAssistant(state, assistantId))
}

/**
 * 默认助手模板
 */
export function useDefaultAssistant() {
  const defaultAssistant = useAppSelector((state) => state.assistants.defaultAssistant)
  const dispatch = useAppDispatch()

  return {
    defaultAssistant,
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
