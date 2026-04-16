import { loggerService } from '@logger'
import {
  getThinkModelType,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  MODEL_SUPPORTED_OPTIONS,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '@renderer/config/models'
import { cacheService } from '@renderer/data/CacheService'
import { db } from '@renderer/databases'
import { useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistant,
  insertAssistant,
  removeAssistant,
  setModel,
  updateAssistant,
  updateAssistants,
  updateAssistantSettings as _updateAssistantSettings,
  updateDefaultAssistant
} from '@renderer/store/assistants'
import { setDefaultModel, setQuickModel, setTranslateModel } from '@renderer/store/llm'
import type { Assistant, AssistantSettings, Model, ThinkingOption, Topic } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export function useAssistants() {
  const { t } = useTranslation()
  const { assistants } = useAppSelector((state) => state.assistants)
  const dispatch = useAppDispatch()
  const logger = loggerService.withContext('useAssistants')

  return {
    assistants,
    updateAssistants: (assistants: Assistant[]) => dispatch(updateAssistants(assistants)),
    addAssistant: (assistant: Assistant) => dispatch(addAssistant(assistant)),
    insertAssistant: (index: number, assistant: Assistant) => dispatch(insertAssistant({ index, assistant })),
    copyAssistant: (assistant: Assistant): Assistant | undefined => {
      if (!assistant) {
        logger.error("assistant doesn't exists.")
        return
      }
      const index = assistants.findIndex((_assistant) => _assistant.id === assistant.id)
      const _assistant: Assistant = { ...assistant, id: uuid(), topics: [getDefaultTopic(assistant.id)] }
      if (index === -1) {
        logger.warn("Origin assistant's id not found. Fallback to addAssistant.")
        dispatch(addAssistant(_assistant))
      } else {
        // 插入到后面
        try {
          dispatch(insertAssistant({ index: index + 1, assistant: _assistant }))
        } catch (e) {
          logger.error('Failed to insert assistant', e as Error)
          window.toast.error(t('message.error.copy'))
        }
      }
      return _assistant
    },
    removeAssistant: (id: string) => {
      dispatch(removeAssistant({ id }))
    }
  }
}

export function useAssistant(id: string) {
  const assistant = useAppSelector((state) => state.assistants.assistants.find((a) => a.id === id) as Assistant)
  const dispatch = useAppDispatch()
  const { defaultModel } = useDefaultModel()
  const {
    createTopic,
    updateTopic: patchTopic,
    deleteTopic,
    deleteAllTopics,
    batchUpdateTopics,
    moveTopic: moveTopicApi
  } = useTopicMutations()

  const model = useMemo(() => assistant?.model ?? assistant?.defaultModel ?? defaultModel, [assistant, defaultModel])
  if (assistant && !model) {
    throw new Error(`Assistant model is not set for assistant with name: ${assistant?.name ?? 'unknown'}`)
  }

  const assistantWithModel = useMemo(() => ({ ...assistant, model }), [assistant, model])

  const settingsRef = useRef(assistant?.settings)

  useEffect(() => {
    settingsRef.current = assistant?.settings
  }, [assistant?.settings])

  const updateAssistantSettings = useCallback(
    (settings: Partial<AssistantSettings>) => {
      assistant?.id && dispatch(_updateAssistantSettings({ assistantId: assistant.id, settings }))
    },
    [assistant?.id, dispatch]
  )

  // 当model变化时，同步reasoning effort为模型支持的合法值
  useEffect(() => {
    const settings = settingsRef.current
    if (settings) {
      const currentReasoningEffort = settings.reasoning_effort
      const cacheKey = `assistant.reasoning_effort_cache.${assistant.id}` as const

      if (isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) {
        const modelType = getThinkModelType(model)
        const supportedOptions = MODEL_SUPPORTED_OPTIONS[modelType]
        if (supportedOptions.every((option) => option !== currentReasoningEffort)) {
          const cache = cacheService.get(cacheKey) as ThinkingOption | undefined
          let fallbackOption: ThinkingOption

          if (cache && supportedOptions.includes(cache)) {
            fallbackOption = cache
          } else {
            const enableThinking = currentReasoningEffort !== undefined
            fallbackOption = enableThinking
              ? MODEL_SUPPORTED_REASONING_EFFORT[modelType][0]
              : MODEL_SUPPORTED_OPTIONS[modelType][0]
          }

          cacheService.set(cacheKey, fallbackOption === 'none' ? undefined : fallbackOption)
          updateAssistantSettings({
            reasoning_effort: fallbackOption === 'none' ? undefined : fallbackOption,
            qwenThinkMode: fallbackOption === 'none' ? undefined : true
          })
        } else {
          // 对于支持的选项, 不再更新 cache.
        }
      } else {
        // 切换到非思考模型时保留cache
        if (currentReasoningEffort !== undefined) {
          cacheService.set(cacheKey, currentReasoningEffort)
        }
        updateAssistantSettings({
          reasoning_effort: undefined,
          qwenThinkMode: undefined
        })
      }
    }
  }, [model, assistant?.id, updateAssistantSettings])

  return {
    assistant: assistantWithModel,
    model,
    addTopic: async (topic: Topic) => {
      await createTopic({ id: topic.id, name: topic.name, assistantId: topic.assistantId })
    },
    removeTopic: async (topic: Topic) => {
      await deleteTopic(topic.id)
    },
    moveTopic: async (topic: Topic, toAssistant: Assistant) => {
      await moveTopicApi(topic.id, toAssistant.id)
      void db.topics
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
    updateTopic: async (topic: Topic) => {
      await patchTopic(topic.id, {
        name: topic.name,
        isNameManuallyEdited: topic.isNameManuallyEdited,
        isPinned: topic.pinned
      })
    },
    updateTopics: async (topics: Topic[]) => {
      await batchUpdateTopics(
        topics.map((t, i) => ({
          id: t.id,
          dto: { name: t.name, isPinned: t.pinned, sortOrder: i }
        }))
      )
    },
    removeAllTopics: async () => {
      await deleteAllTopics(assistant.id)
    },
    setModel: useCallback(
      (model: Model) => assistant && dispatch(setModel({ assistantId: assistant?.id, model })),
      [assistant, dispatch]
    ),
    updateAssistant: useCallback(
      (update: Partial<Omit<Assistant, 'id'>>) => dispatch(updateAssistant({ id, ...update })),
      [dispatch, id]
    ),
    updateAssistantSettings
  }
}

export function useDefaultAssistant() {
  const defaultAssistant = useAppSelector((state) => state.assistants.defaultAssistant)
  const dispatch = useAppDispatch()
  const { defaultModel } = useDefaultModel()
  const memoizedTopics = useMemo(() => [getDefaultTopic(defaultAssistant.id)], [defaultAssistant.id])
  const resolvedDefaultModel = defaultAssistant.defaultModel ?? defaultModel
  const resolvedModel = defaultAssistant.model ?? resolvedDefaultModel

  return {
    defaultAssistant: {
      ...defaultAssistant,
      defaultModel: resolvedDefaultModel,
      model: resolvedModel,
      topics: memoizedTopics
    },
    updateDefaultAssistant: (assistant: Assistant) =>
      dispatch(
        updateDefaultAssistant({
          assistant: {
            ...assistant,
            model: defaultAssistant.model,
            defaultModel: defaultAssistant.defaultModel,
            topics: defaultAssistant.topics
          }
        })
      )
  }
}

export function useDefaultModel() {
  const { defaultModel, quickModel, translateModel } = useAppSelector((state) => state.llm)
  const dispatch = useAppDispatch()

  return {
    defaultModel,
    quickModel,
    translateModel,
    setDefaultModel: (model: Model) => dispatch(setDefaultModel({ model })),
    setQuickModel: (model: Model) => dispatch(setQuickModel({ model })),
    setTranslateModel: (model: Model) => dispatch(setTranslateModel({ model }))
  }
}
