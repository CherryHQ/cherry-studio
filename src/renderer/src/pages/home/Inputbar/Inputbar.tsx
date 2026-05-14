import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isGenerateImageModel, isGenerateImageModels, isVisionModel, isVisionModels } from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useCache } from '@renderer/data/hooks/useCache'
import { useChatWrite } from '@renderer/hooks/ChatWriteContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useInputText } from '@renderer/hooks/useInputText'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTextareaResize } from '@renderer/hooks/useTextareaResize'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicAwaitingApproval } from '@renderer/hooks/useTopicAwaitingApproval'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import {
  InputbarToolsProvider,
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import { type AddNewTopicPayload, EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { type FileMetadata, type KnowledgeBase, type Model, type Topic, TopicType } from '@renderer/types'
import { delay } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { FC } from 'react'
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InputbarCore } from './components/InputbarCore'
import { resolveNewTopicAssistantId } from './Inputbar.helpers'
import InputbarTools from './InputbarTools'
import KnowledgeBaseInput from './KnowledgeBaseInput'
import MentionModelsInput from './MentionModelsInput'
import { getInputbarConfig } from './registry'

const logger = loggerService.withContext('Inputbar')

const INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

const getMentionedModelsCacheKey = (assistantId: string | undefined) =>
  `inputbar-mentioned-models-${assistantId ?? 'no-assistant'}`

const getValidatedCachedModels = (assistantId: string | undefined): Model[] => {
  const cached = cacheService.getCasual<Model[]>(getMentionedModelsCacheKey(assistantId))
  if (!Array.isArray(cached)) return []
  return cached.filter((model) => model?.id && model?.name)
}

interface Props {
  setActiveTopic: (topic: Topic) => void
  topic: Topic
  onSend: (
    text: string,
    options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }
  ) => void | Promise<void>
}

type ProviderActionHandlers = {
  resizeTextArea: () => void
  addNewTopic: (payload?: AddNewTopicPayload) => void
  clearTopic: () => void
  onNewContext: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
}

interface InputbarInnerProps extends Props {
  actionsRef: React.RefObject<ProviderActionHandlers>
}

const Inputbar: FC<Props> = ({ setActiveTopic, topic, onSend: onSendProp }) => {
  const actionsRef = useRef<ProviderActionHandlers>({
    resizeTextArea: () => {},
    addNewTopic: () => {},
    clearTopic: () => {},
    onNewContext: () => {},
    onTextChange: () => {},
    toggleExpanded: () => {}
  })

  const [initialMentionedModels] = useState(() => getValidatedCachedModels(topic.assistantId))

  const initialState = useMemo(
    () => ({
      files: [] as FileMetadata[],
      mentionedModels: initialMentionedModels,
      selectedKnowledgeBases: [] as KnowledgeBase[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    [initialMentionedModels]
  )

  return (
    <InputbarToolsProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        addNewTopic: () => actionsRef.current.addNewTopic(),
        clearTopic: () => actionsRef.current.clearTopic(),
        onNewContext: () => actionsRef.current.onNewContext(),
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        toggleExpanded: (next) => actionsRef.current.toggleExpanded(next)
      }}>
      <InputbarInner setActiveTopic={setActiveTopic} topic={topic} actionsRef={actionsRef} onSend={onSendProp} />
    </InputbarToolsProvider>
  )
}

const InputbarInner: FC<InputbarInnerProps> = ({ setActiveTopic, topic, actionsRef, onSend: onSendProp }) => {
  const awaitingApproval = useTopicAwaitingApproval(topic.id)

  const scope = topic.type ?? TopicType.Chat
  const config = getInputbarConfig(scope)

  const { files, mentionedModels, selectedKnowledgeBases } = useInputbarToolsState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases } = useInputbarToolsDispatch()
  const { setCouldAddImageFile } = useInputbarToolsInternalDispatch()

  const { text, setText } = useInputText({
    initialValue: cacheService.getCasual<string>(INPUTBAR_DRAFT_CACHE_KEY) ?? '',
    onChange: (value) => cacheService.setCasual(INPUTBAR_DRAFT_CACHE_KEY, value, DRAFT_CACHE_TTL)
  })
  const {
    textareaRef,
    resize: resizeTextArea,
    focus: focusTextarea,
    setExpanded,
    isExpanded: textareaIsExpanded,
    customHeight,
    setCustomHeight
  } = useTextareaResize({
    maxHeight: 500,
    minHeight: 30
  })

  const { assistant, model, updateAssistant } = useAssistant(topic.assistantId)
  const { createTopic } = useTopicMutations()
  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])
  const { knowledgeBases: allKnowledgeBases } = useKnowledgeBases()
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableQuickPanelTriggers] = usePreference('chat.input.quick_panel.triggers_enabled')

  const { t } = useTranslation()
  const chatWrite = useChatWrite()
  const { isPending } = useTopicStreamStatus(topic.id)
  const [isSending, setIsSending] = useState(false)
  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])
  useEffect(() => {
    setIsSending(false)
  }, [topic.id])
  const loading = isPending || isSending || awaitingApproval
  const isVisionAssistant = useMemo(() => (v1Model ? isVisionModel(v1Model) : false), [v1Model])
  const isGenerateImageAssistant = useMemo(() => (v1Model ? isGenerateImageModel(v1Model) : false), [v1Model])
  const { setTimeoutTimer } = useTimer()
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')

  const isVisionSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isVisionModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isVisionAssistant),
    [mentionedModels, isVisionAssistant]
  )

  const isGenerateImageSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isGenerateImageModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isGenerateImageAssistant),
    [mentionedModels, isGenerateImageAssistant]
  )

  const canAddImageFile = useMemo(() => {
    return isVisionSupported || isGenerateImageSupported
  }, [isGenerateImageSupported, isVisionSupported])

  const canAddTextFile = useMemo(() => {
    return isVisionSupported || (!isVisionSupported && !isGenerateImageSupported)
  }, [isGenerateImageSupported, isVisionSupported])

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) {
      return [...imageExts, ...documentExts, ...textExts]
    }

    if (canAddImageFile) {
      return [...imageExts]
    }

    if (canAddTextFile) {
      return [...documentExts, ...textExts]
    }

    return []
  }, [canAddImageFile, canAddTextFile])

  useEffect(() => {
    setCouldAddImageFile(canAddImageFile)
  }, [canAddImageFile, setCouldAddImageFile])

  const onUnmount = useEffectEvent((id: string | undefined) => {
    cacheService.setCasual(getMentionedModelsCacheKey(id), mentionedModels, DRAFT_CACHE_TTL)
  })

  useEffect(() => {
    return () => onUnmount(topic.assistantId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic.assistantId])

  const placeholderText = enableQuickPanelTriggers
    ? t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })
    : t('chat.input.placeholder_without_triggers', {
        key: getSendMessageShortcutLabel(sendMessageShortcut),
        defaultValue: t('chat.input.placeholder', {
          key: getSendMessageShortcutLabel(sendMessageShortcut)
        })
      })

  const sendMessage = useCallback(async () => {
    const text_ = text.trim()
    if (!text_) return
    setIsSending(true)
    setText('')
    setFiles([])
    setTimeoutTimer('sendMessage', () => resizeTextArea(), 0)
    focusTextarea()
    // Await `onSendProp` in a try/finally so `isSending` clears on any
    // terminal state — success path relies on the `pending` broadcast
    // effect above, but sync/async failures (validation, IPC reject,
    // transport error) never reach `pending` and would otherwise
    // strand the input bar in pause mode.
    try {
      await onSendProp(text_, {
        files: files.length > 0 ? files : undefined,
        mentionedModels:
          mentionedModels.length > 0
            ? mentionedModels.map((model) =>
                isUniqueModelId(model.id) ? model.id : createUniqueModelId(model.provider, model.id)
              )
            : undefined
      })
    } catch (error) {
      logger.warn('send failed', { error })
    } finally {
      setIsSending(false)
    }
  }, [onSendProp, text, mentionedModels, files, setText, setFiles, setTimeoutTimer, resizeTextArea, focusTextarea])

  const onPause = useCallback(() => {
    chatWrite?.pause()
  }, [chatWrite])

  const clearTopic = useCallback(async () => {
    if (loading) {
      onPause()
      await delay(1)
    }

    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
    focusTextarea()
  }, [focusTextarea, loading, onPause, topic])

  const onNewContext = useCallback(() => {
    if (loading) {
      onPause()
      return
    }
    void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [loading, onPause])

  const addNewTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      const assistantId = resolveNewTopicAssistantId(topic.assistantId, payload)
      const persisted = await createTopic({ assistantId, name: t('chat.default.topic.name') })
      if (!persisted) return
      setActiveTopic(mapApiTopicToRendererTopic(persisted))

      setTimeoutTimer('addNewTopic', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
    },
    [createTopic, topic.assistantId, t, setActiveTopic, setTimeoutTimer]
  )

  const handleRemoveModel = useCallback(
    (modelToRemove: Model) => {
      setMentionedModels(mentionedModels.filter((current) => current.id !== modelToRemove.id))
    },
    [mentionedModels, setMentionedModels]
  )

  const handleRemoveKnowledgeBase = useCallback(
    (knowledgeBase: KnowledgeBase) => {
      const nextIds = (assistant?.knowledgeBaseIds ?? []).filter((id) => id !== knowledgeBase.id)
      void updateAssistant({ knowledgeBaseIds: nextIds })
      setSelectedKnowledgeBases(allKnowledgeBases.filter((kb) => nextIds.includes(kb.id)) as unknown as KnowledgeBase[])
    },
    [assistant?.knowledgeBaseIds, allKnowledgeBases, setSelectedKnowledgeBases, updateAssistant]
  )

  const handleToggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !textareaIsExpanded
      setExpanded(target)
      focusTextarea()
    },
    [focusTextarea, setExpanded, textareaIsExpanded]
  )

  useEffect(() => {
    actionsRef.current = {
      resizeTextArea,
      addNewTopic,
      clearTopic,
      onNewContext,
      onTextChange: setText,
      toggleExpanded: handleToggleExpanded
    }
  }, [resizeTextArea, addNewTopic, clearTopic, onNewContext, setText, handleToggleExpanded, actionsRef])

  useShortcut(
    'topic.new',
    () => {
      void addNewTopic()
      void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      focusTextarea()
    },
    { preventDefault: true, enableOnFormTags: true }
  )

  useShortcut('chat.clear', clearTopic, {
    preventDefault: true,
    enableOnFormTags: true
  })

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)]
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [addNewTopic])

  useEffect(() => {
    if (!document.querySelector('.topview-fullscreen-container')) {
      focusTextarea()
    }
  }, [
    topic.id,
    assistant?.mcpServerIds,
    assistant?.knowledgeBaseIds,
    assistant?.settings.enableWebSearch,
    mentionedModels,
    focusTextarea
  ])

  useEffect(() => {
    const ids = assistant?.knowledgeBaseIds ?? []
    if (ids.length === 0) {
      setSelectedKnowledgeBases([])
      return
    }
    setSelectedKnowledgeBases(allKnowledgeBases.filter((kb) => ids.includes(kb.id)) as unknown as KnowledgeBase[])
  }, [assistant?.knowledgeBaseIds, allKnowledgeBases, setSelectedKnowledgeBases])

  if (isMultiSelectMode) {
    return null
  }

  // topContent: 所有顶部预览内容
  const topContent = (
    <>
      {selectedKnowledgeBases.length > 0 && (
        <KnowledgeBaseInput
          selectedKnowledgeBases={selectedKnowledgeBases}
          onRemoveKnowledgeBase={handleRemoveKnowledgeBase}
        />
      )}

      {mentionedModels.length > 0 && (
        <MentionModelsInput selectedModels={mentionedModels} onRemoveModel={handleRemoveModel} />
      )}
    </>
  )

  // leftToolbar: 左侧工具栏
  const leftToolbar =
    config.showTools && assistant && v1Model ? (
      <InputbarTools scope={scope} assistant={assistant} model={v1Model} />
    ) : null

  return (
    <InputbarCore
      scope={scope}
      placeholder={placeholderText}
      text={text}
      onTextChange={setText}
      textareaRef={textareaRef}
      height={customHeight}
      onHeightChange={setCustomHeight}
      resizeTextArea={resizeTextArea}
      focusTextarea={focusTextarea}
      isLoading={loading}
      supportedExts={supportedExts}
      onPause={onPause}
      handleSendMessage={sendMessage}
      leftToolbar={leftToolbar}
      primaryActionMode={loading ? 'pause' : 'send'}
      topContent={topContent}
    />
  )
}

export default Inputbar
