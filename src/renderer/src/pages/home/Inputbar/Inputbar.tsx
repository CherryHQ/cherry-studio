import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import {
  isAutoEnableImageGenerationModel,
  isGenerateImageModel,
  isGenerateImageModels,
  isMandatoryWebSearchModel,
  isVisionModel,
  isVisionModels,
  isWebSearchModel
} from '@renderer/config/models'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useInputText } from '@renderer/hooks/useInputText'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTextareaResize } from '@renderer/hooks/useTextareaResize'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import {
  InputbarToolsProvider,
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { estimateTextTokens as estimateTxtTokens } from '@renderer/services/TokenService'
import { webSearchService } from '@renderer/services/WebSearchService'
import {
  type Assistant,
  type FileMetadata,
  type KnowledgeBase,
  type Model,
  type Topic,
  TopicType
} from '@renderer/types'
import { delay } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { debounce } from 'lodash'
import type { FC } from 'react'
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InputbarCore } from './components/InputbarCore'
import InputbarTools from './InputbarTools'
import KnowledgeBaseInput from './KnowledgeBaseInput'
import MentionModelsInput from './MentionModelsInput'
import { getInputbarConfig } from './registry'
import TokenCount from './TokenCount'

const INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

const getMentionedModelsCacheKey = (assistantId: string) => `inputbar-mentioned-models-${assistantId}`

const getValidatedCachedModels = (assistantId: string): Model[] => {
  const cached = cacheService.getCasual<Model[]>(getMentionedModelsCacheKey(assistantId))
  if (!Array.isArray(cached)) return []
  return cached.filter((model) => model?.id && model?.name)
}

interface Props {
  assistant: Assistant
  setActiveTopic: (topic: Topic) => void
  topic: Topic
  onSend: (text: string, options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }) => void
}

type ProviderActionHandlers = {
  resizeTextArea: () => void
  addNewTopic: () => void
  clearTopic: () => void
  onNewContext: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
}

interface InputbarInnerProps extends Props {
  actionsRef: React.RefObject<ProviderActionHandlers>
}

const Inputbar: FC<Props> = ({ assistant: initialAssistant, setActiveTopic, topic, onSend: onSendProp }) => {
  const actionsRef = useRef<ProviderActionHandlers>({
    resizeTextArea: () => {},
    addNewTopic: () => {},
    clearTopic: () => {},
    onNewContext: () => {},
    onTextChange: () => {},
    toggleExpanded: () => {}
  })

  const [initialMentionedModels] = useState(() => getValidatedCachedModels(initialAssistant.id))

  const initialState = useMemo(
    () => ({
      files: [] as FileMetadata[],
      mentionedModels: initialMentionedModels,
      selectedKnowledgeBases: initialAssistant.knowledge_bases ?? [],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    [initialMentionedModels, initialAssistant.knowledge_bases]
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
      <InputbarInner
        assistant={initialAssistant}
        setActiveTopic={setActiveTopic}
        topic={topic}
        actionsRef={actionsRef}
        onSend={onSendProp}
      />
    </InputbarToolsProvider>
  )
}

const InputbarInner: FC<InputbarInnerProps> = ({
  assistant: initialAssistant,
  setActiveTopic,
  topic,
  actionsRef,
  onSend: onSendProp
}) => {
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

  const { assistant, addTopic, model, setModel, updateAssistant } = useAssistant(initialAssistant.id)
  const [showInputEstimatedTokens] = usePreference('chat.input.show_estimated_tokens')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableQuickPanelTriggers] = usePreference('chat.input.quick_panel.triggers_enabled')
  const [estimateTokenCount, setEstimateTokenCount] = useState(0)
  const [contextCount, setContextCount] = useState({ current: 0, max: 0 })

  const { t } = useTranslation()
  const v2Chat = useV2Chat()
  const { isPending } = useTopicStreamStatus(topic.id)
  const [isSending, setIsSending] = useState(false)
  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])
  useEffect(() => {
    setIsSending(false)
  }, [topic.id])
  const loading = isPending || isSending
  const isVisionAssistant = useMemo(() => isVisionModel(model), [model])
  const isGenerateImageAssistant = useMemo(() => isGenerateImageModel(model), [model])
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

  const onUnmount = useEffectEvent((id: string) => {
    cacheService.setCasual(getMentionedModelsCacheKey(id), mentionedModels, DRAFT_CACHE_TTL)
  })

  useEffect(() => {
    return () => onUnmount(assistant.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.id])

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
    onSendProp(text_, {
      files: files.length > 0 ? files : undefined,
      mentionedModels:
        mentionedModels.length > 0
          ? mentionedModels.map((model) =>
              isUniqueModelId(model.id) ? model.id : createUniqueModelId(model.provider, model.id)
            )
          : undefined
    })
    setText('')
    setFiles([])
    setTimeoutTimer('sendMessage', () => resizeTextArea(), 0)
    focusTextarea()
  }, [onSendProp, text, mentionedModels, files, setText, setFiles, setTimeoutTimer, resizeTextArea, focusTextarea])

  const tokenCountProps = useMemo(() => {
    if (!config.showTokenCount || estimateTokenCount === undefined || !showInputEstimatedTokens) {
      return undefined
    }

    return {
      estimateTokenCount,
      inputTokenCount: estimateTokenCount,
      contextCount
    }
  }, [config.showTokenCount, contextCount, estimateTokenCount, showInputEstimatedTokens])

  const onPause = useCallback(() => {
    v2Chat?.pause()
  }, [v2Chat])

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

  const addNewTopic = useCallback(async () => {
    if (assistant.defaultModel) {
      setModel(assistant.defaultModel)
    }

    // `addTopic` returns the DataApi-persisted topic whose id is the one
    // Main will recognise. Activating the local seed (`getDefaultTopic`)
    // would leave `activeTopic.id` pointing at an unpersisted UUID, which
    // then makes `Ai_Stream_Open` fail with "Topic not found".
    const persisted = await addTopic(getDefaultTopic(assistant.id))
    if (!persisted) return
    setActiveTopic(persisted)

    setTimeoutTimer('addNewTopic', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  }, [addTopic, assistant.defaultModel, assistant.id, setActiveTopic, setModel, setTimeoutTimer])

  const handleRemoveModel = useCallback(
    (modelToRemove: Model) => {
      setMentionedModels(mentionedModels.filter((current) => current.id !== modelToRemove.id))
    },
    [mentionedModels, setMentionedModels]
  )

  const handleRemoveKnowledgeBase = useCallback(
    (knowledgeBase: KnowledgeBase) => {
      const nextKnowledgeBases = assistant.knowledge_bases?.filter((kb) => kb.id !== knowledgeBase.id)
      updateAssistant({ ...assistant, knowledge_bases: nextKnowledgeBases })
      setSelectedKnowledgeBases(nextKnowledgeBases ?? [])
    },
    [assistant, setSelectedKnowledgeBases, updateAssistant]
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
    const _setEstimateTokenCount = debounce(setEstimateTokenCount, 100, { leading: false, trailing: true })
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, ({ tokensCount, contextCount }) => {
        _setEstimateTokenCount(tokensCount)
        setContextCount({ current: contextCount.current, max: contextCount.max })
      }),
      ...[EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)]
    ]

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [addNewTopic])

  useEffect(() => {
    const debouncedEstimate = debounce((value: string) => {
      if (showInputEstimatedTokens) {
        const count = estimateTxtTokens(value) || 0
        setEstimateTokenCount(count)
      }
    }, 500)

    debouncedEstimate(text)
    return () => debouncedEstimate.cancel()
  }, [showInputEstimatedTokens, text])

  useEffect(() => {
    if (!document.querySelector('.topview-fullscreen-container')) {
      focusTextarea()
    }
  }, [
    topic.id,
    assistant.mcpServers,
    assistant.knowledge_bases,
    assistant.enableWebSearch,
    assistant.webSearchProviderId,
    mentionedModels,
    focusTextarea
  ])

  // TODO: Just use assistant.knowledge_bases as selectedKnowledgeBases. context state is overdesigned.
  useEffect(() => {
    setSelectedKnowledgeBases(assistant.knowledge_bases ?? [])
  }, [assistant.knowledge_bases, setSelectedKnowledgeBases])

  useEffect(() => {
    // Disable web search if model doesn't support it
    if (!isWebSearchModel(model) && assistant.enableWebSearch) {
      updateAssistant({ ...assistant, enableWebSearch: false })
    }

    // Clear web search provider if disabled or model has mandatory search
    if (
      assistant.webSearchProviderId &&
      (!webSearchService.isWebSearchEnabled(assistant.webSearchProviderId) || isMandatoryWebSearchModel(model))
    ) {
      updateAssistant({ ...assistant, webSearchProviderId: undefined })
    }

    // v1 legacy: auto-enable/disable image generation when the user switches
    // to a model that IS an image generator. v2 moves image gen to tool
    // calls — a general chat model invokes an image tool, so this side-
    // effect goes away (the toggle disappears, no per-model flip needed).
    if (isGenerateImageModel(model)) {
      if (isAutoEnableImageGenerationModel(model) && !assistant.enableGenerateImage) {
        updateAssistant({ ...assistant, enableGenerateImage: true })
      }
    } else if (assistant.enableGenerateImage) {
      updateAssistant({ ...assistant, enableGenerateImage: false })
    }
  }, [assistant, model, updateAssistant])

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
  const leftToolbar = config.showTools ? <InputbarTools scope={scope} assistant={assistant} model={model} /> : null

  // rightToolbar: 右侧工具栏
  const rightToolbar = (
    <>
      {tokenCountProps && (
        <TokenCount
          estimateTokenCount={tokenCountProps.estimateTokenCount}
          inputTokenCount={tokenCountProps.inputTokenCount}
          contextCount={tokenCountProps.contextCount}
          onClick={onNewContext}
        />
      )}
    </>
  )

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
      rightToolbar={rightToolbar}
      primaryActionMode={loading ? 'pause' : 'send'}
      topContent={topContent}
    />
  )
}

export default Inputbar
