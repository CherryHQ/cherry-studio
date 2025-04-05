import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistant,
  removeAssistant,
  setModel,
  updateAssistant,
  updateAssistants,
  updateAssistantSettings,
  updateDefaultAssistant
} from '@renderer/store/assistants'
import { setDefaultModel, setTopicNamingModel, setTranslateModel } from '@renderer/store/llm'
import { removeAssistantTopics, selectTopicsByAssistantId } from '@renderer/store/topics'
import { addTopic as addTopicToState } from '@renderer/store/topics'
import { Assistant, AssistantSettings, Model, Topic } from '@renderer/types'
import { useCallback } from 'react'

export function useAssistants() {
  const { assistants } = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()

  return {
    assistants,
    updateAssistants: (assistants: Assistant[]) => dispatch(updateAssistants(assistants)),
    addAssistant: (assistant: Assistant) => dispatch(addAssistant(assistant)),
    removeAssistant: (id: string) => dispatch(removeAssistant({ id }))
  }
}

export function useAssistant(id: string) {
  const assistant = useAppSelector((state) => state.assistants.assistants.find((a) => a.id === id) as Assistant)
  const topics = useAppSelector((state) => selectTopicsByAssistantId(state, assistant.id))

  const dispatch = useAppDispatch()
  const { defaultModel } = useDefaultModel()

  return {
    assistant,
    topics, // 该助手负责的话题（不一定是所有它参与的话题）
    model: assistant?.model ?? assistant?.defaultModel ?? defaultModel,
    addTopic: (topic: Topic) => {
      dispatch(addTopicToState({ topic, assistantId: assistant.id }))
    },
    removeAllTopics: () => {
      dispatch(removeAssistantTopics(assistant.id))
    },
    setModel: useCallback(
      (model: Model) => dispatch(setModel({ assistantId: assistant.id, model })),
      [dispatch, assistant.id]
    ),
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
