import { HolderOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol, QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import TranslateButton from '@renderer/components/TranslateButton'
import {
  isAutoEnableImageGenerationModel,
  isGenerateImageModel,
  isGenerateImageModels,
  isMandatoryWebSearchModel,
  isVisionModel,
  isVisionModels,
  isWebSearchModel
} from '@renderer/config/models'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useMessageOperations, useTopicLoading } from '@renderer/hooks/useMessageOperations'
import { modelGenerating, useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { useTimer } from '@renderer/hooks/useTimer'
import useTranslate from '@renderer/hooks/useTranslate'
import { InputbarToolsProvider, useInputbarTools } from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import { checkRateLimit, getUserMessage } from '@renderer/services/MessagesService'
import PasteService from '@renderer/services/PasteService'
import { spanManagerService } from '@renderer/services/SpanManagerService'
import { estimateTextTokens as estimateTxtTokens, estimateUserPromptUsage } from '@renderer/services/TokenService'
import { translateText } from '@renderer/services/TranslateService'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSearching } from '@renderer/store/runtime'
import { sendMessage as _sendMessage } from '@renderer/store/thunk/messageThunk'
import { Assistant, FileType, KnowledgeBase, Model, Topic, TopicType } from '@renderer/types'
import type { MessageInputBaseParams } from '@renderer/types/newMessage'
import { classNames, delay, filterSupportedFiles } from '@renderer/utils'
import { formatQuotedText } from '@renderer/utils/formats'
import {
  getFilesFromDropEvent,
  getSendMessageShortcutLabel,
  getTextFromDropEvent,
  isSendMessageKeyPressed
} from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { debounce, isEmpty } from 'lodash'
import { CirclePause } from 'lucide-react'
import React, { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import NarrowLayout from '../Messages/NarrowLayout'
import AttachmentPreview from './AttachmentPreview'
import InputbarTools from './InputbarTools'
import KnowledgeBaseInput from './KnowledgeBaseInput'
import MentionModelsInput from './MentionModelsInput'
import { getInputbarConfig } from './registry'
import SendMessageButton from './SendMessageButton'
import TokenCount from './TokenCount'
import { InputbarScope } from './types'

const logger = loggerService.withContext('Inputbar')

interface Props {
  assistant: Assistant
  setActiveTopic: (topic: Topic) => void
  topic: Topic
}

type ProviderActionHandlers = {
  resizeTextArea: () => void
  addNewTopic: () => void
  clearTopic: () => void
  onNewContext: () => void
}

interface InputbarInnerProps extends Props {
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
}

const Inputbar: FC<Props> = ({ assistant: initialAssistant, setActiveTopic, topic }) => {
  const actionsRef = useRef<ProviderActionHandlers>({
    resizeTextArea: () => {},
    addNewTopic: () => {},
    clearTopic: () => {},
    onNewContext: () => {}
  })

  const initialState = useMemo(
    () => ({
      files: [] as FileType[],
      mentionedModels: [] as Model[],
      selectedKnowledgeBases: initialAssistant.knowledge_bases ?? [],
      text: '',
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    [initialAssistant.knowledge_bases]
  )

  return (
    <InputbarToolsProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        addNewTopic: () => actionsRef.current.addNewTopic(),
        clearTopic: () => actionsRef.current.clearTopic(),
        onNewContext: () => actionsRef.current.onNewContext()
      }}>
      <InputbarInner
        assistant={initialAssistant}
        setActiveTopic={setActiveTopic}
        topic={topic}
        actionsRef={actionsRef}
      />
    </InputbarToolsProvider>
  )
}

const InputbarInner: FC<InputbarInnerProps> = ({ assistant: initialAssistant, setActiveTopic, topic, actionsRef }) => {
  const scope = useMemo<InputbarScope>(() => topic.type ?? TopicType.Chat, [topic.type])
  const config = useMemo(() => getInputbarConfig(scope), [scope])
  const features = config.features

  const {
    files,
    setFiles,
    mentionedModels,
    setMentionedModels,
    selectedKnowledgeBases,
    setSelectedKnowledgeBases,
    text,
    setText,
    isExpanded,
    setIsExpanded,
    setCouldAddImageFile,
    setExtensions,
    emitQuickPanelTrigger
  } = useInputbarTools()

  const showKnowledgeIcon = useSidebarIconShow('knowledge')
  const [inputFocus, setInputFocus] = useState(false)
  const { assistant, addTopic, model, setModel, updateAssistant } = useAssistant(initialAssistant.id)
  const {
    targetLanguage,
    sendMessageShortcut,
    fontSize,
    pasteLongTextAsFile,
    pasteLongTextThreshold,
    showInputEstimatedTokens,
    autoTranslateWithSpace,
    enableQuickPanelTriggers,
    enableSpellCheck
  } = useSettings()
  const [estimateTokenCount, setEstimateTokenCount] = useState(0)
  const [contextCount, setContextCount] = useState({ current: 0, max: 0 })
  const textareaRef = useRef<TextAreaRef | null>(null)
  const { t } = useTranslation()
  const { getLanguageByLangcode } = useTranslate()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { searching } = useRuntime()
  const { pauseMessages } = useMessageOperations(topic)
  const loading = useTopicLoading(topic)
  const dispatch = useAppDispatch()
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const spaceClickTimer = useRef<NodeJS.Timeout | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [isFileDragging, setIsFileDragging] = useState(false)
  const [textareaHeight, setTextareaHeight] = useState<number>()
  const startDragY = useRef<number>(0)
  const startHeight = useRef<number>(0)
  const isMultiSelectMode = useAppSelector((state) => state.runtime.chat.isMultiSelectMode)
  const isVisionAssistant = useMemo(() => isVisionModel(model), [model])
  const isGenerateImageAssistant = useMemo(() => isGenerateImageModel(model), [model])
  const { setTimeoutTimer } = useTimer()
  const quickPanel = useQuickPanel()

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
    if (!features.enableAttachments) {
      return false
    }
    return isVisionSupported || isGenerateImageSupported
  }, [features.enableAttachments, isGenerateImageSupported, isVisionSupported])

  const canAddTextFile = useMemo(() => {
    if (!features.enableAttachments) {
      return false
    }
    return isVisionSupported || (!isVisionSupported && !isGenerateImageSupported)
  }, [features.enableAttachments, isGenerateImageSupported, isVisionSupported])

  const supportedExts = useMemo(() => {
    if (!features.enableAttachments) {
      return []
    }

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
  }, [canAddImageFile, canAddTextFile, features.enableAttachments])

  const prevTextRef = useRef(text)

  useEffect(() => {
    setCouldAddImageFile(canAddImageFile)
  }, [canAddImageFile, setCouldAddImageFile])

  useEffect(() => {
    prevTextRef.current = text
  }, [text])

  const placeholderText = enableQuickPanelTriggers
    ? t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })
    : t('chat.input.placeholder_without_triggers', {
        key: getSendMessageShortcutLabel(sendMessageShortcut),
        defaultValue: t('chat.input.placeholder', {
          key: getSendMessageShortcutLabel(sendMessageShortcut)
        })
      })

  useEffect(() => {
    setExtensions(supportedExts)
  }, [setExtensions, supportedExts])

  const setInputText = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      if (typeof value === 'function') {
        setText((prev) => value(prev))
      } else {
        setText(value)
      }
    },
    [setText]
  )

  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus()
  }, [])

  const resizeTextArea = useCallback(
    (force: boolean = false) => {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (!textArea) {
        return
      }

      if (textareaHeight && !force) {
        return
      }

      textArea.style.height = 'auto'
      if (textArea.scrollHeight) {
        textArea.style.height = Math.min(textArea.scrollHeight, 400) + 'px'
      }
    },
    [textareaHeight]
  )

  const inputEmpty = useMemo(() => isEmpty(text.trim()) && files.length === 0, [files.length, text])

  const sendMessage = useCallback(async () => {
    if (!features.enableSendButton || inputEmpty) {
      return
    }
    if (checkRateLimit(assistant)) {
      return
    }

    logger.info('Starting to send message')

    const parent = spanManagerService.startTrace(
      { topicId: topic.id, name: 'sendMessage', inputs: text },
      mentionedModels.length > 0 ? mentionedModels : [assistant.model]
    )
    EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id, traceId: parent?.spanContext().traceId })

    try {
      const uploadedFiles = await FileManager.uploadFiles(files)

      const baseUserMessage: MessageInputBaseParams = { assistant, topic, content: text }
      if (uploadedFiles) {
        baseUserMessage.files = uploadedFiles
      }
      if (mentionedModels.length) {
        baseUserMessage.mentions = mentionedModels
      }

      baseUserMessage.usage = await estimateUserPromptUsage(baseUserMessage)

      const { message, blocks } = getUserMessage(baseUserMessage)
      message.traceId = parent?.spanContext().traceId

      dispatch(_sendMessage(message, blocks, assistant, topic.id))

      setText('')
      setFiles([])
      setTimeoutTimer('sendMessage_1', () => setText(''), 500)
      setTimeoutTimer('sendMessage_2', () => resizeTextArea(true), 0)
      setIsExpanded(false)
    } catch (error) {
      logger.warn('Failed to send message:', error as Error)
      parent?.recordException(error as Error)
    }
  }, [
    assistant,
    dispatch,
    features.enableSendButton,
    files,
    inputEmpty,
    mentionedModels,
    resizeTextArea,
    setFiles,
    setIsExpanded,
    setText,
    setTimeoutTimer,
    text,
    topic
  ])

  const translate = useCallback(async () => {
    if (isTranslating || !features.enableTranslate) {
      return
    }

    try {
      setIsTranslating(true)
      const translatedText = await translateText(text, getLanguageByLangcode(targetLanguage))
      translatedText && setText(translatedText)
      setTimeoutTimer('translate', () => resizeTextArea(), 0)
    } catch (error) {
      logger.warn('Translation failed:', error as Error)
    } finally {
      setIsTranslating(false)
    }
  }, [
    features.enableTranslate,
    getLanguageByLangcode,
    isTranslating,
    resizeTextArea,
    setText,
    setTimeoutTimer,
    targetLanguage,
    text
  ])

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

  // const quickPanelRootMenuItems = useMemo(() => {
  //   if (!config.enableQuickPanel) {
  //     return []
  //   }

  //   const baseMenu = [...quickPanelRootMenu]

  //   if (features.enableTranslate) {
  //     baseMenu.push({
  //       label: t('translate.title'),
  //       description: t('translate.menu.description'),
  //       icon: <Languages size={16} />,
  //       action: () => {
  //         if (!text) return
  //         translate()
  //       }
  //     })
  //   }

  //   return baseMenu
  // }, [config.enableQuickPanel, features.enableTranslate, quickPanelRootMenu, t, text, translate])

  const onToggleExpanded = useCallback(() => {
    if (!features.enableExpand) {
      return
    }

    const currentlyExpanded = isExpanded || !!textareaHeight
    const shouldExpand = !currentlyExpanded
    setIsExpanded(shouldExpand)

    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (!textArea) {
      return
    }

    if (shouldExpand) {
      textArea.style.height = '70vh'
      setTextareaHeight(window.innerHeight * 0.7)
    } else {
      textArea.style.height = 'auto'
      setTextareaHeight(undefined)
      requestAnimationFrame(() => {
        if (textArea) {
          const contentHeight = textArea.scrollHeight
          textArea.style.height = contentHeight > 400 ? '400px' : `${contentHeight}px`
        }
      })
    }

    focusTextarea()
  }, [features.enableExpand, focusTextarea, isExpanded, setIsExpanded, textareaHeight])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autoTranslateWithSpace && event.key === ' ') {
        setSpaceClickCount((prev) => prev + 1)
        if (spaceClickTimer.current) {
          clearTimeout(spaceClickTimer.current)
        }
        spaceClickTimer.current = setTimeout(() => {
          setSpaceClickCount(0)
        }, 200)

        if (spaceClickCount === 2 && features.enableTranslate) {
          logger.info('Triple space detected - trigger translation')
          setSpaceClickCount(0)
          translate()
          return
        }
      }

      if (features.enableExpand && (isExpanded || !!textareaHeight) && event.key === 'Escape') {
        event.stopPropagation()
        onToggleExpanded()
        return
      }

      const isEnterPressed = event.key === 'Enter' && !event.nativeEvent.isComposing
      if (isEnterPressed) {
        if (isSendMessageKeyPressed(event, sendMessageShortcut)) {
          sendMessage()
          event.preventDefault()
          return
        }

        if (event.shiftKey) {
          return
        }

        event.preventDefault()
        const textArea = textareaRef.current?.resizableTextArea?.textArea
        if (textArea) {
          const start = textArea.selectionStart
          const end = textArea.selectionEnd
          const currentText = textArea.value
          const newText = currentText.substring(0, start) + '\n' + currentText.substring(end)

          setText(newText)

          setTimeoutTimer(
            'handleKeyDown',
            () => {
              textArea.selectionStart = textArea.selectionEnd = start + 1
            },
            0
          )
        }
      }

      if (event.key === 'Backspace' && text.length === 0 && files.length > 0) {
        setFiles((prev) => prev.slice(0, -1))
        event.preventDefault()
      }
    },
    [
      autoTranslateWithSpace,
      features.enableExpand,
      features.enableTranslate,
      files.length,
      isExpanded,
      onToggleExpanded,
      sendMessage,
      sendMessageShortcut,
      setFiles,
      setText,
      setTimeoutTimer,
      spaceClickCount,
      text,
      textareaHeight,
      translate
    ]
  )

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = event.nativeEvent
      const handled = await PasteService.handlePaste(
        nativeEvent,
        supportedExts,
        setFiles,
        setText,
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        text,
        resizeTextArea,
        t
      )

      if (handled) {
        event.preventDefault()
      }
    },
    [pasteLongTextAsFile, pasteLongTextThreshold, resizeTextArea, setFiles, setText, supportedExts, t, text]
  )

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value
      setText(newText)

      const prevText = prevTextRef.current
      const isDeletion = newText.length < prevText.length

      const textArea = textareaRef.current?.resizableTextArea?.textArea
      const cursorPosition = textArea?.selectionStart ?? newText.length
      const lastSymbol = newText[cursorPosition - 1]
      const previousChar = newText[cursorPosition - 2]
      const isCursorAtTextStart = cursorPosition <= 1
      const hasValidTriggerBoundary = previousChar === ' ' || isCursorAtTextStart

      const textBeforeCursor = newText.slice(0, cursorPosition)
      const lastRootIndex = textBeforeCursor.lastIndexOf(QuickPanelReservedSymbol.Root)
      const lastMentionIndex = textBeforeCursor.lastIndexOf(QuickPanelReservedSymbol.MentionModels)
      const lastTriggerIndex = Math.max(lastRootIndex, lastMentionIndex)

      if (lastTriggerIndex !== -1 && cursorPosition > lastTriggerIndex) {
        const triggerChar = newText[lastTriggerIndex]
        const boundaryChar = newText[lastTriggerIndex - 1] ?? ''
        const hasBoundary = lastTriggerIndex === 0 || /\s/.test(boundaryChar)
        const searchSegment = newText.slice(lastTriggerIndex + 1, cursorPosition)
        const hasSearchContent = searchSegment.trim().length > 0

        if (hasBoundary && (!hasSearchContent || isDeletion)) {
          if (triggerChar === QuickPanelReservedSymbol.Root) {
            emitQuickPanelTrigger(QuickPanelReservedSymbol.Root, {
              type: 'input',
              position: lastTriggerIndex
            })
          } else if (triggerChar === QuickPanelReservedSymbol.MentionModels) {
            emitQuickPanelTrigger(QuickPanelReservedSymbol.MentionModels, {
              type: 'input',
              position: lastTriggerIndex
            })
          }
        }
      }

      // 触发符号为 '/'：若当前未打开或符号不同，则切换/打开
      if (
        enableQuickPanelTriggers &&
        config.enableQuickPanel &&
        features.enableMentionModels &&
        lastSymbol === QuickPanelReservedSymbol.MentionModels &&
        hasValidTriggerBoundary
      ) {
        if (quickPanel.isVisible && quickPanel.symbol !== QuickPanelReservedSymbol.MentionModels) {
          quickPanel.close('switch-symbol')
        }
        if (!quickPanel.isVisible || quickPanel.symbol !== QuickPanelReservedSymbol.MentionModels) {
          emitQuickPanelTrigger(QuickPanelReservedSymbol.MentionModels, {
            type: 'input',
            position: cursorPosition - 1,
            originalText: newText
          })
        }
      }

      prevTextRef.current = newText
    },
    [
      config.enableQuickPanel,
      emitQuickPanelTrigger,
      enableQuickPanelTriggers,
      features.enableMentionModels,
      quickPanel,
      setText
    ]
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!features.enableAttachments) {
        return
      }
      setIsFileDragging(true)
    },
    [features.enableAttachments]
  )

  const handleDragEnter = handleDragOver

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!features.enableAttachments) {
        return
      }
      setIsFileDragging(false)
    },
    [features.enableAttachments]
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      if (features.enableAttachments) {
        setIsFileDragging(false)
      }

      const droppedText = await getTextFromDropEvent(event)
      if (droppedText) {
        setText((prev) => prev + droppedText)
      }

      if (!features.enableAttachments) {
        return
      }

      const droppedFiles = await getFilesFromDropEvent(event).catch((err) => {
        logger.error('handleDrop:', err)
        return null
      })

      if (droppedFiles) {
        const supportedFiles = await filterSupportedFiles(droppedFiles, supportedExts)
        if (supportedFiles.length > 0) {
          setFiles((prevFiles) => [...prevFiles, ...supportedFiles])
        }

        if (droppedFiles.length > 0 && supportedFiles.length !== droppedFiles.length) {
          window.toast.info(
            t('chat.input.file_not_supported_count', {
              count: droppedFiles.length - supportedFiles.length
            })
          )
        }
      }
    },
    [features.enableAttachments, setFiles, setText, supportedExts, t]
  )

  const onTranslated = useCallback(
    (translatedText: string) => {
      setText(translatedText)
      setTimeoutTimer('onTranslated', () => resizeTextArea(), 0)
    },
    [resizeTextArea, setText, setTimeoutTimer]
  )

  const handleDragStart = useCallback(
    (event: React.MouseEvent) => {
      if (!config.enableDragDrop) {
        return
      }

      startDragY.current = event.clientY
      startHeight.current = textareaRef.current?.resizableTextArea?.textArea?.offsetHeight || 0

      const handleMouseMove = (e: MouseEvent) => {
        const deltaY = startDragY.current - e.clientY
        const newHeight = Math.max(40, Math.min(400, startHeight.current + deltaY))
        setTextareaHeight(newHeight)
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [config.enableDragDrop]
  )

  const onQuote = useCallback(
    (quoted: string) => {
      const formatted = formatQuotedText(quoted)
      setText((prevText) => {
        const next = prevText ? `${prevText}\n${formatted}\n` : `${formatted}\n`
        setTimeoutTimer('onQuote', () => resizeTextArea(), 0)
        return next
      })
      focusTextarea()
    },
    [focusTextarea, resizeTextArea, setText, setTimeoutTimer]
  )

  const onPause = useCallback(async () => {
    await pauseMessages()
  }, [pauseMessages])

  const clearTopic = useCallback(async () => {
    if (!features.enableClearTopic) {
      return
    }

    if (loading) {
      await onPause()
      await delay(1)
    }

    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
    focusTextarea()
  }, [features.enableClearTopic, focusTextarea, loading, onPause, topic])

  const onNewContext = useCallback(() => {
    if (!features.enableNewContext) {
      return
    }

    if (loading) {
      onPause()
      return
    }
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [features.enableNewContext, loading, onPause])

  const addNewTopic = useCallback(async () => {
    if (!features.enableNewTopic) {
      return
    }

    await modelGenerating()

    const newTopic = getDefaultTopic(assistant.id)

    await db.topics.add({ id: newTopic.id, messages: [] })

    if (assistant.defaultModel) {
      setModel(assistant.defaultModel)
    }

    addTopic(newTopic)
    setActiveTopic(newTopic)

    setTimeoutTimer('addNewTopic', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  }, [
    addTopic,
    assistant.defaultModel,
    assistant.id,
    features.enableNewTopic,
    setActiveTopic,
    setModel,
    setTimeoutTimer
  ])

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

  useShortcut(
    'new_topic',
    () => {
      addNewTopic()
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      focusTextarea()
    },
    { preventDefault: true, enableOnFormTags: true, enabled: features.enableNewTopic }
  )

  useShortcut('clear_topic', clearTopic, {
    preventDefault: true,
    enableOnFormTags: true,
    enabled: features.enableClearTopic
  })

  useEffect(() => {
    const _setEstimateTokenCount = debounce(setEstimateTokenCount, 100, { leading: false, trailing: true })
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, ({ tokensCount, contextCount }) => {
        _setEstimateTokenCount(tokensCount)
        setContextCount({ current: contextCount.current, max: contextCount.max })
      }),
      ...(features.enableNewTopic ? [EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)] : [])
    ]

    const quoteListener = window.electron?.ipcRenderer.on(IpcChannel.App_QuoteToMain, (_, selectedText: string) =>
      onQuote(selectedText)
    )

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
      quoteListener?.()
    }
  }, [addNewTopic, features.enableNewTopic, onQuote])

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

  useEffect(() => {
    const timerId = requestAnimationFrame(() => resizeTextArea())
    return () => cancelAnimationFrame(timerId)
  }, [resizeTextArea])

  useEffect(() => {
    const onFocus = () => {
      if (document.activeElement?.closest('.ant-modal')) {
        return
      }

      const lastFocusedComponent = PasteService.getLastFocusedComponent()
      if (!lastFocusedComponent || lastFocusedComponent === 'inputbar') {
        focusTextarea()
      }
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [focusTextarea])

  useEffect(() => {
    actionsRef.current = {
      resizeTextArea,
      addNewTopic,
      clearTopic,
      onNewContext
    }
  }, [actionsRef, addNewTopic, clearTopic, onNewContext, resizeTextArea])

  useEffect(() => {
    setSelectedKnowledgeBases(showKnowledgeIcon && features.enableKnowledge ? (assistant.knowledge_bases ?? []) : [])
  }, [assistant.knowledge_bases, features.enableKnowledge, setSelectedKnowledgeBases, showKnowledgeIcon])

  useEffect(() => {
    if (!features.enableWebSearch && assistant.enableWebSearch) {
      updateAssistant({ ...assistant, enableWebSearch: false })
    } else if (features.enableWebSearch && !isWebSearchModel(model) && assistant.enableWebSearch) {
      updateAssistant({ ...assistant, enableWebSearch: false })
    }

    if (
      assistant.webSearchProviderId &&
      (!WebSearchService.isWebSearchEnabled(assistant.webSearchProviderId) || isMandatoryWebSearchModel(model))
    ) {
      updateAssistant({ ...assistant, webSearchProviderId: undefined })
    }

    if (!features.enableGenImage && assistant.enableGenerateImage) {
      updateAssistant({ ...assistant, enableGenerateImage: false })
      return
    }

    if (isGenerateImageModel(model)) {
      if (isAutoEnableImageGenerationModel(model) && !assistant.enableGenerateImage) {
        updateAssistant({ ...assistant, enableGenerateImage: true })
      }
    } else if (assistant.enableGenerateImage) {
      updateAssistant({ ...assistant, enableGenerateImage: false })
    }
  }, [assistant, features.enableGenImage, features.enableWebSearch, model, updateAssistant])

  useEffect(() => {
    if (!config.enableQuickPanel) {
      quickPanel.close()
      return
    }

    PasteService.init()
    PasteService.registerHandler('inputbar', (event) =>
      PasteService.handlePaste(
        event,
        supportedExts,
        setFiles,
        setText,
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        text,
        resizeTextArea,
        t
      )
    )

    return () => {
      PasteService.unregisterHandler('inputbar')
    }
  }, [
    config.enableQuickPanel,
    pasteLongTextAsFile,
    pasteLongTextThreshold,
    quickPanel,
    resizeTextArea,
    setFiles,
    setText,
    supportedExts,
    t,
    text
  ])

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [])

  const rightSectionExtras = useMemo(() => {
    const extras: React.ReactNode[] = []

    if (features.enableTranslate) {
      extras.push(<TranslateButton key="translate" text={text} onTranslated={onTranslated} isLoading={isTranslating} />)
    }

    if (features.enableAbortButton && loading) {
      extras.push(
        <Tooltip key="pause" placement="top" title={t('chat.input.pause')} mouseLeaveDelay={0} arrow>
          <ActionIconButton onClick={onPause} style={{ marginRight: -2 }}>
            <CirclePause size={20} color="var(--color-error)" />
          </ActionIconButton>
        </Tooltip>
      )
    }

    if (extras.length === 0) {
      return null
    }

    return <>{extras}</>
  }, [features.enableAbortButton, features.enableTranslate, isTranslating, loading, onPause, onTranslated, t, text])

  if (isMultiSelectMode) {
    return null
  }

  const composerExpanded = isExpanded || !!textareaHeight

  return (
    <NarrowLayout style={{ width: '100%' }}>
      <Container
        ref={containerRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="inputbar">
        <InputBarContainer
          id="inputbar"
          className={classNames(
            'inputbar-container',
            inputFocus && 'focus',
            isFileDragging && 'file-dragging',
            composerExpanded && 'expanded'
          )}>
          {features.enableAttachments && files.length > 0 && <AttachmentPreview files={files} setFiles={setFiles} />}

          {features.enableKnowledge && selectedKnowledgeBases.length > 0 && (
            <KnowledgeBaseInput
              selectedKnowledgeBases={selectedKnowledgeBases}
              onRemoveKnowledgeBase={handleRemoveKnowledgeBase}
            />
          )}

          {features.enableMentionModels && mentionedModels.length > 0 && (
            <MentionModelsInput selectedModels={mentionedModels} onRemoveModel={handleRemoveModel} />
          )}

          <Textarea
            value={text}
            onKeyDown={handleKeyDown}
            placeholder={isTranslating ? t('chat.input.translating') : config.placeholder || placeholderText}
            autoFocus
            variant="borderless"
            spellCheck={enableSpellCheck}
            rows={2}
            autoSize={textareaHeight ? false : { minRows: 2, maxRows: 20 }}
            ref={textareaRef}
            styles={{ textarea: TextareaStyle }}
            onChange={handleTextareaChange}
            onPaste={handlePaste}
            onFocus={() => {
              setInputFocus(true)
              dispatch(setSearching(false))
              quickPanel.close()
              PasteService.setLastFocusedComponent('inputbar')
            }}
            onBlur={() => setInputFocus(false)}
            onClick={() => {
              if (searching) {
                dispatch(setSearching(false))
              }
              quickPanel.close()
            }}
            style={{
              fontSize,
              height: textareaHeight,
              minHeight: '30px'
            }}
            disabled={loading || searching}
          />

          {config.enableDragDrop && (
            <DragHandle onMouseDown={handleDragStart}>
              <HolderOutlined style={{ fontSize: 12 }} />
            </DragHandle>
          )}

          <BottomBar>
            <LeftSection>{config.showTools && <InputbarTools scope={scope} assistantId={assistant.id} />}</LeftSection>

            <RightSection>
              {tokenCountProps && (
                <TokenCount
                  estimateTokenCount={tokenCountProps.estimateTokenCount}
                  inputTokenCount={tokenCountProps.inputTokenCount}
                  contextCount={tokenCountProps.contextCount}
                />
              )}

              {features.enableSendButton && (
                <SendMessageButton sendMessage={sendMessage} disabled={inputEmpty || loading || searching} />
              )}

              {rightSectionExtras}
            </RightSection>
          </BottomBar>
        </InputBarContainer>

        {config.enableQuickPanel && <QuickPanelView setInputText={setInputText} />}
      </Container>
    </NarrowLayout>
  )
}

// Add these styled components at the bottom
const DragHandle = styled.div`
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  color: var(--color-icon);
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 1;

  &:hover {
    opacity: 1;
  }

  .anticon {
    transform: rotate(90deg);
    font-size: 14px;
  }
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 2;
  padding: 0 18px 18px 18px;
  [navbar-position='top'] & {
    padding: 0 18px 10px 18px;
  }
`

const InputBarContainer = styled.div`
  border: 0.5px solid var(--color-border);
  transition: all 0.2s ease;
  position: relative;
  border-radius: 17px;
  padding-top: 8px;
  background-color: var(--color-background-opacity);

  &.file-dragging {
    border: 2px dashed #2ecc71;

    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(46, 204, 113, 0.03);
      border-radius: 14px;
      z-index: 5;
      pointer-events: none;
    }
  }
`

const TextareaStyle: CSSProperties = {
  paddingLeft: 0,
  padding: '6px 15px 0px' // 减小顶部padding
}

const Textarea = styled(TextArea)`
  padding: 0;
  border-radius: 0;
  display: flex;
  resize: none !important;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  transition: none !important;
  &.ant-input {
    line-height: 1.4;
  }
  &::-webkit-scrollbar {
    width: 3px;
  }
`

const BottomBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 5px 8px;
  height: 40px;
  gap: 16px;
  position: relative;
  z-index: 2;
  flex-shrink: 0;
`

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
`

const RightSection = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

export default Inputbar
