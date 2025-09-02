import { HolderOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import TranslateButton from '@renderer/components/TranslateButton'
import {
  isAutoEnableImageGenerationModel,
  isGenerateImageModel,
  isGenerateImageModels,
  isMandatoryWebSearchModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isVisionModel,
  isVisionModels,
  isWebSearchModel
} from '@renderer/config/models'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useMessageOperations, useTopicLoading } from '@renderer/hooks/useMessageOperations'
import { modelGenerating, useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut, useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { useTimer } from '@renderer/hooks/useTimer'
import useTranslate from '@renderer/hooks/useTranslate'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import { checkRateLimit, getUserMessage } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import PasteService from '@renderer/services/PasteService'
import { spanManagerService } from '@renderer/services/SpanManagerService'
import { estimateTextTokens as estimateTxtTokens, estimateUserPromptUsage } from '@renderer/services/TokenService'
import { translateText } from '@renderer/services/TranslateService'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSearching } from '@renderer/store/runtime'
import { sendMessage as _sendMessage } from '@renderer/store/thunk/messageThunk'
import { Assistant, FileType, FileTypes, KnowledgeBase, KnowledgeItem, Model, Topic } from '@renderer/types'
import type { MessageInputBaseParams } from '@renderer/types/newMessage'
import { classNames, delay, filterSupportedFiles, formatFileSize } from '@renderer/utils'
import { formatQuotedText } from '@renderer/utils/formats'
import {
  getFilesFromDropEvent,
  getSendMessageShortcutLabel,
  getTextFromDropEvent,
  isSendMessageKeyPressed
} from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Button, Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import dayjs from 'dayjs'
import { debounce, isEmpty } from 'lodash'
import { CirclePause, FileSearch, FileText, Upload } from 'lucide-react'
import React, { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import NarrowLayout from '../Messages/NarrowLayout'
import AttachmentPreview from './AttachmentPreview'
import InputbarTools, { InputbarToolsRef } from './InputbarTools'
import SendMessageButton from './SendMessageButton'
import TokenCount from './TokenCount'

const logger = loggerService.withContext('Inputbar')

interface Props {
  assistant: Assistant
  setActiveTopic: (topic: Topic) => void
  topic: Topic
}

let _text = ''
let _files: FileType[] = []

const Inputbar: FC<Props> = ({ assistant: _assistant, setActiveTopic, topic }) => {
  const [text, setText] = useState(_text)
  const [inputFocus, setInputFocus] = useState(false)
  const { assistant, addTopic, model, setModel, updateAssistant } = useAssistant(_assistant.id)
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
  const [expanded, setExpand] = useState(false)
  const [estimateTokenCount, setEstimateTokenCount] = useState(0)
  const [contextCount, setContextCount] = useState({ current: 0, max: 0 })
  const textareaRef = useRef<TextAreaRef>(null)
  const [files, setFiles] = useState<FileType[]>(_files)
  const { t } = useTranslation()
  const { getLanguageByLangcode } = useTranslate()
  const containerRef = useRef(null)
  const { searching } = useRuntime()
  const { pauseMessages } = useMessageOperations(topic)
  const loading = useTopicLoading(topic)
  const dispatch = useAppDispatch()
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const spaceClickTimer = useRef<NodeJS.Timeout>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [mentionedModels, setMentionedModels] = useState<Model[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isFileDragging, setIsFileDragging] = useState(false)
  const [textareaHeight, setTextareaHeight] = useState<number>()
  const startDragY = useRef<number>(0)
  const startHeight = useRef<number>(0)
  const { bases: knowledgeBases } = useKnowledgeBases()
  const isMultiSelectMode = useAppSelector((state) => state.runtime.chat.isMultiSelectMode)
  const isVisionAssistant = useMemo(() => isVisionModel(model), [model])
  const isGenerateImageAssistant = useMemo(() => isGenerateImageModel(model), [model])
  const { setTimeoutTimer } = useTimer()

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

  // 仅允许在不含图片文件时mention非视觉模型
  const couldMentionNotVisionModel = useMemo(() => {
    return !files.some((file) => file.type === FileTypes.IMAGE)
  }, [files])

  // 允许在支持视觉或生成图片时添加图片文件
  const couldAddImageFile = useMemo(() => {
    return isVisionSupported || isGenerateImageSupported
  }, [isVisionSupported, isGenerateImageSupported])

  const couldAddTextFile = useMemo(() => {
    return isVisionSupported || (!isVisionSupported && !isGenerateImageSupported)
  }, [isGenerateImageSupported, isVisionSupported])

  const supportedExts = useMemo(() => {
    if (couldAddImageFile && couldAddTextFile) {
      return [...imageExts, ...documentExts, ...textExts]
    } else if (couldAddImageFile) {
      return [...imageExts]
    } else if (couldAddTextFile) {
      return [...documentExts, ...textExts]
    } else {
      return []
    }
  }, [couldAddImageFile, couldAddTextFile])

  const quickPanel = useQuickPanel()

  const showKnowledgeIcon = useSidebarIconShow('knowledge')

  const [tokenCount, setTokenCount] = useState(0)

  const inputbarToolsRef = useRef<InputbarToolsRef>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedEstimate = useCallback(
    debounce((newText) => {
      if (showInputEstimatedTokens) {
        const count = estimateTxtTokens(newText) || 0
        setTokenCount(count)
      }
    }, 500),
    [showInputEstimatedTokens]
  )

  useEffect(() => {
    debouncedEstimate(text)
  }, [text, debouncedEstimate])

  const inputTokenCount = showInputEstimatedTokens ? tokenCount : 0

  const newTopicShortcut = useShortcutDisplay('new_topic')
  const cleanTopicShortcut = useShortcutDisplay('clear_topic')
  const inputEmpty = isEmpty(text.trim()) && files.length === 0

  _text = text
  _files = files

  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus()
  }, [])

  const resizeTextArea = useCallback(
    (force: boolean = false) => {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        // 如果已经手动设置了高度,则不自动调整
        if (textareaHeight && !force) {
          return
        }
        if (textArea?.scrollHeight) {
          textArea.style.height = Math.min(textArea.scrollHeight, 400) + 'px'
        }
      }
    },
    [textareaHeight]
  )

  const sendMessage = useCallback(async () => {
    if (inputEmpty) {
      return
    }
    if (checkRateLimit(assistant)) {
      return
    }

    logger.info('Starting to send message')

    const parent = spanManagerService.startTrace(
      { topicId: topic.id, name: 'sendMessage', inputs: text },
      mentionedModels && mentionedModels.length > 0 ? mentionedModels : [assistant.model]
    )
    EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id, traceId: parent?.spanContext().traceId })

    try {
      // Dispatch the sendMessage action with all options
      const uploadedFiles = await FileManager.uploadFiles(files)

      const baseUserMessage: MessageInputBaseParams = { assistant, topic, content: text }
      logger.info('baseUserMessage', baseUserMessage)

      // getUserMessage()
      if (uploadedFiles) {
        baseUserMessage.files = uploadedFiles
      }

      if (mentionedModels) {
        baseUserMessage.mentions = mentionedModels
      }

      baseUserMessage.usage = await estimateUserPromptUsage(baseUserMessage)

      const { message, blocks } = getUserMessage(baseUserMessage)
      message.traceId = parent?.spanContext().traceId

      dispatch(_sendMessage(message, blocks, assistant, topic.id))

      // Clear input
      setText('')
      setFiles([])
      setTimeoutTimer('sendMessage_1', () => setText(''), 500)
      setTimeoutTimer('sendMessage_2', () => resizeTextArea(true), 0)
      setExpand(false)
    } catch (error) {
      logger.warn('Failed to send message:', error as Error)
      parent?.recordException(error as Error)
    }
  }, [assistant, dispatch, files, inputEmpty, mentionedModels, resizeTextArea, setTimeoutTimer, text, topic])

  const translate = useCallback(async () => {
    if (isTranslating) {
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
  }, [isTranslating, text, getLanguageByLangcode, targetLanguage, setTimeoutTimer, resizeTextArea])

  const openKnowledgeFileList = useCallback(
    (base: KnowledgeBase) => {
      quickPanel.open({
        title: base.name,
        list: base.items
          .filter((file): file is KnowledgeItem => ['file'].includes(file.type))
          .map((file) => {
            const fileContent = file.content as FileType
            return {
              label: fileContent.origin_name || fileContent.name,
              description:
                formatFileSize(fileContent.size) + ' · ' + dayjs(fileContent.created_at).format('YYYY-MM-DD HH:mm'),
              icon: <FileText />,
              isSelected: files.some((f) => f.path === fileContent.path),
              action: async ({ item }) => {
                item.isSelected = !item.isSelected
                if (fileContent.path) {
                  setFiles((prevFiles) => {
                    const fileExists = prevFiles.some((f) => f.path === fileContent.path)
                    if (fileExists) {
                      return prevFiles.filter((f) => f.path !== fileContent.path)
                    } else {
                      return fileContent ? [...prevFiles, fileContent] : prevFiles
                    }
                  })
                }
              }
            }
          }),
        symbol: 'file',
        multiple: true
      })
    },
    [files, quickPanel]
  )

  const openSelectFileMenu = useCallback(() => {
    quickPanel.open({
      title: t('chat.input.upload.label'),
      list: [
        {
          label: t('chat.input.upload.upload_from_local'),
          description: '',
          icon: <Upload />,
          action: () => {
            inputbarToolsRef.current?.openAttachmentQuickPanel()
          }
        },
        ...knowledgeBases.map((base) => {
          const length = base.items?.filter(
            (item): item is KnowledgeItem => ['file', 'note'].includes(item.type) && typeof item.content !== 'string'
          ).length
          return {
            label: base.name,
            description: `${length} ${t('files.count')}`,
            icon: <FileSearch />,
            disabled: length === 0,
            isMenu: true,
            action: () => openKnowledgeFileList(base)
          }
        })
      ],
      symbol: 'file'
    })
  }, [knowledgeBases, openKnowledgeFileList, quickPanel, t, inputbarToolsRef])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 按下Tab键，自动选中${xxx}
    if (event.key === 'Tab' && inputFocus) {
      event.preventDefault()
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (!textArea) return

      const cursorPosition = textArea.selectionStart
      const selectionLength = textArea.selectionEnd - textArea.selectionStart
      const text = textArea.value

      let match = text.slice(cursorPosition + selectionLength).match(/\$\{[^}]+\}/)
      let startIndex: number

      if (!match) {
        match = text.match(/\$\{[^}]+\}/)
        startIndex = match?.index ?? -1
      } else {
        startIndex = cursorPosition + selectionLength + match.index!
      }

      if (startIndex !== -1) {
        const endIndex = startIndex + match![0].length
        textArea.setSelectionRange(startIndex, endIndex)
        return
      }
    }

    if (autoTranslateWithSpace) {
      if (event.key === ' ') {
        setSpaceClickCount((prev) => prev + 1)

        if (spaceClickTimer.current) {
          clearTimeout(spaceClickTimer.current)
        }

        spaceClickTimer.current = setTimeout(() => {
          setSpaceClickCount(0)
        }, 200)

        if (spaceClickCount === 2) {
          logger.info('Triple space detected - trigger translation')
          setSpaceClickCount(0)
          setIsTranslating(true)
          translate()
          return
        }
      }
    }

    if (expanded) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        return onToggleExpanded()
      }
    }

    //to check if the SendMessage key is pressed
    //other keys should be ignored
    const isEnterPressed = event.key === 'Enter' && !event.nativeEvent.isComposing
    if (isEnterPressed) {
      if (quickPanel.isVisible) return event.preventDefault()

      if (isSendMessageKeyPressed(event, sendMessageShortcut)) {
        sendMessage()
        return event.preventDefault()
      } else {
        //shift+enter's default behavior is to add a new line, ignore it
        if (!event.shiftKey) {
          event.preventDefault()

          const textArea = textareaRef.current?.resizableTextArea?.textArea
          if (textArea) {
            const start = textArea.selectionStart
            const end = textArea.selectionEnd
            const text = textArea.value
            const newText = text.substring(0, start) + '\n' + text.substring(end)

            // update text by setState, not directly modify textarea.value
            setText(newText)

            // set cursor position in the next render cycle
            setTimeoutTimer(
              'handleKeyDown',
              () => {
                textArea.selectionStart = textArea.selectionEnd = start + 1
                onInput() // trigger resizeTextArea
              },
              0
            )
          }
        }
      }
    }

    if (event.key === 'Backspace' && text.trim() === '' && files.length > 0) {
      setFiles((prev) => prev.slice(0, -1))
      return event.preventDefault()
    }
  }

  const addNewTopic = useCallback(async () => {
    await modelGenerating()

    const topic = getDefaultTopic(assistant.id)

    await db.topics.add({ id: topic.id, messages: [] })

    // Clear previous state
    // Reset to assistant default model
    assistant.defaultModel && setModel(assistant.defaultModel)

    addTopic(topic)
    setActiveTopic(topic)

    setTimeoutTimer('addNewTopic', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  }, [addTopic, assistant.defaultModel, assistant.id, setActiveTopic, setModel, setTimeoutTimer])

  const onQuote = useCallback(
    (text: string) => {
      const quotedText = formatQuotedText(text)
      setText((prevText) => {
        const newText = prevText ? `${prevText}\n${quotedText}\n` : `${quotedText}\n`
        setTimeoutTimer('onQuote', () => resizeTextArea(), 0)
        return newText
      })
      focusTextarea()
    },
    [focusTextarea, setTimeoutTimer, resizeTextArea]
  )

  const onPause = async () => {
    await pauseMessages()
  }

  const clearTopic = async () => {
    if (loading) {
      await onPause()
      await delay(1)
    }
    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
    focusTextarea()
  }

  const onNewContext = () => {
    if (loading) {
      onPause()
      return
    }
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }

  const onInput = () => !expanded && resizeTextArea()

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value
      setText(newText)

      const textArea = textareaRef.current?.resizableTextArea?.textArea
      const cursorPosition = textArea?.selectionStart ?? 0
      const lastSymbol = newText[cursorPosition - 1]

      // 触发符号为 '/'：若当前未打开或符号不同，则切换/打开
      if (enableQuickPanelTriggers && lastSymbol === '/') {
        if (quickPanel.isVisible && quickPanel.symbol !== '/') {
          quickPanel.close('switch-symbol')
        }
        if (!quickPanel.isVisible || quickPanel.symbol !== '/') {
          const quickPanelMenu =
            inputbarToolsRef.current?.getQuickPanelMenu({
              t,
              files,
              couldAddImageFile,
              text: newText,
              openSelectFileMenu,
              translate
            }) || []

          quickPanel.open({
            title: t('settings.quickPanel.title'),
            list: quickPanelMenu,
            symbol: '/'
          })
        }
      }

      // 触发符号为 '@'：若当前未打开或符号不同，则切换/打开
      if (enableQuickPanelTriggers && lastSymbol === '@') {
        if (quickPanel.isVisible && quickPanel.symbol !== '@') {
          quickPanel.close('switch-symbol')
        }
        if (!quickPanel.isVisible || quickPanel.symbol !== '@') {
          inputbarToolsRef.current?.openMentionModelsPanel({
            type: 'input',
            position: cursorPosition - 1,
            originalText: newText
          })
        }
      }
    },
    [enableQuickPanelTriggers, quickPanel, t, files, couldAddImageFile, openSelectFileMenu, translate]
  )

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      return await PasteService.handlePaste(
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
    },
    [pasteLongTextAsFile, pasteLongTextThreshold, resizeTextArea, supportedExts, t, text]
  )

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragging(true)
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragging(false)
  }

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsFileDragging(false)

      const data = await getTextFromDropEvent(e)

      setText(text + data)

      const droppedFiles = await getFilesFromDropEvent(e).catch((err) => {
        logger.error('handleDrop:', err)
        return null
      })

      if (droppedFiles) {
        const supportedFiles = await filterSupportedFiles(droppedFiles, supportedExts)
        supportedFiles.length > 0 && setFiles((prevFiles) => [...prevFiles, ...supportedFiles])
        if (droppedFiles.length > 0 && supportedFiles.length !== droppedFiles.length) {
          window.message.info({
            key: 'file_not_supported',
            content: t('chat.input.file_not_supported_count', {
              count: droppedFiles.length - supportedFiles.length
            })
          })
        }
      }
    },
    [supportedExts, t, text]
  )

  const onTranslated = (translatedText: string) => {
    setText(translatedText)
    setTimeoutTimer('onTranslated', () => resizeTextArea(), 0)
  }

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startDragY.current = e.clientY
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      startHeight.current = textArea.offsetHeight
    }
  }

  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return

      const delta = startDragY.current - e.clientY // 改变计算方向
      const viewportHeight = window.innerHeight
      const maxHeightInPixels = viewportHeight * 0.7

      const newHeight = Math.min(maxHeightInPixels, Math.max(startHeight.current + delta, 30))
      const textArea = textareaRef.current?.resizableTextArea?.textArea

      if (textArea) {
        textArea.style.height = `${newHeight}px`
        setExpand(newHeight == maxHeightInPixels)
        setTextareaHeight(newHeight)
      }
    },
    [isDragging]
  )

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', handleDragEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd])

  // 注册粘贴处理函数并初始化全局监听
  useEffect(() => {
    // 确保全局paste监听器仅初始化一次
    PasteService.init()

    // 注册当前组件的粘贴处理函数
    PasteService.registerHandler('inputbar', onPaste)

    // 卸载时取消注册
    return () => {
      PasteService.unregisterHandler('inputbar')
    }
  }, [onPaste])

  useShortcut('new_topic', () => {
    addNewTopic()
    EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    focusTextarea()
  })

  useShortcut('clear_topic', clearTopic)

  useEffect(() => {
    const _setEstimateTokenCount = debounce(setEstimateTokenCount, 100, { leading: false, trailing: true })
    const unsubscribes = [
      // EventEmitter.on(EVENT_NAMES.EDIT_MESSAGE, (message: Message) => {
      //   setText(message.content)
      //   textareaRef.current?.focus()
      //   setTimeout(() => resizeTextArea(), 0)
      // }),
      EventEmitter.on(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, ({ tokensCount, contextCount }) => {
        _setEstimateTokenCount(tokensCount)
        setContextCount({ current: contextCount.current, max: contextCount.max }) // 现在contextCount是一个对象而不是单个数值
      }),
      EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)
    ]

    // 监听引用事件
    const quoteFromAnywhereRemover = window.electron?.ipcRenderer.on(
      IpcChannel.App_QuoteToMain,
      (_, selectedText: string) => onQuote(selectedText)
    )

    return () => {
      unsubscribes.forEach((unsub) => unsub())
      quoteFromAnywhereRemover?.()
    }
  }, [addNewTopic, onQuote])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [])

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
    // if assistant knowledge bases are undefined return []
    setSelectedKnowledgeBases(showKnowledgeIcon ? (assistant.knowledge_bases ?? []) : [])
  }, [assistant.id, assistant.knowledge_bases, showKnowledgeIcon])

  const handleKnowledgeBaseSelect = (bases?: KnowledgeBase[]) => {
    updateAssistant({ ...assistant, knowledge_bases: bases })
    setSelectedKnowledgeBases(bases ?? [])
  }

  const onEnableGenerateImage = () => {
    updateAssistant({ ...assistant, enableGenerateImage: !assistant.enableGenerateImage })
  }

  useEffect(() => {
    if (!isWebSearchModel(model) && assistant.enableWebSearch) {
      updateAssistant({ ...assistant, enableWebSearch: false })
    }
    if (
      assistant.webSearchProviderId &&
      (!WebSearchService.isWebSearchEnabled(assistant.webSearchProviderId) || isMandatoryWebSearchModel(model))
    ) {
      updateAssistant({ ...assistant, webSearchProviderId: undefined })
    }
    if (!isGenerateImageModel(model) && assistant.enableGenerateImage) {
      updateAssistant({ ...assistant, enableGenerateImage: false })
    }
    if (isAutoEnableImageGenerationModel(model) && !assistant.enableGenerateImage) {
      updateAssistant({ ...assistant, enableGenerateImage: true })
    }
  }, [assistant, model, updateAssistant])

  const onMentionModel = useCallback(
    (model: Model) => {
      // 我想应该没有模型是只支持视觉而不支持文本的？
      if (isVisionModel(model) || couldMentionNotVisionModel) {
        setMentionedModels((prev) => {
          const modelId = getModelUniqId(model)
          const exists = prev.some((m) => getModelUniqId(m) === modelId)
          return exists ? prev.filter((m) => getModelUniqId(m) !== modelId) : [...prev, model]
        })
      } else {
        logger.error('Cannot add non-vision model when images are uploaded')
      }
    },
    [couldMentionNotVisionModel]
  )

  const onClearMentionModels = useCallback(() => setMentionedModels([]), [setMentionedModels])

  const onToggleExpanded = () => {
    const currentlyExpanded = expanded || !!textareaHeight
    const shouldExpand = !currentlyExpanded
    setExpand(shouldExpand)
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (!textArea) return
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
  }

  const isExpanded = expanded || !!textareaHeight
  const showThinkingButton = isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)

  if (isMultiSelectMode) {
    return null
  }

  return (
    <NarrowLayout style={{ width: '100%' }}>
      <Container
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        className="inputbar">
        <QuickPanelView setInputText={setText} />
        <InputBarContainer
          id="inputbar"
          className={classNames('inputbar-container', inputFocus && 'focus', isFileDragging && 'file-dragging')}
          ref={containerRef}>
          {files.length > 0 && <AttachmentPreview files={files} setFiles={setFiles} />}
          <Textarea
            value={text}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isTranslating
                ? t('chat.input.translating')
                : t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })
            }
            autoFocus
            variant="borderless"
            spellCheck={enableSpellCheck}
            rows={2}
            autoSize={textareaHeight ? false : { minRows: 2, maxRows: 20 }}
            ref={textareaRef}
            style={{
              fontSize,
              minHeight: textareaHeight ? `${textareaHeight}px` : '30px'
            }}
            styles={{ textarea: TextareaStyle }}
            onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => {
              setInputFocus(true)
              // 记录当前聚焦的组件
              PasteService.setLastFocusedComponent('inputbar')
              if (e.target.value.length === 0) {
                e.target.setSelectionRange(0, 0)
              }
            }}
            onBlur={() => setInputFocus(false)}
            onInput={onInput}
            disabled={searching}
            onPaste={(e) => onPaste(e.nativeEvent)}
            onClick={() => {
              searching && dispatch(setSearching(false))
              quickPanel.close()
            }}
          />
          <DragHandle onMouseDown={handleDragStart}>
            <HolderOutlined />
          </DragHandle>
          <Toolbar>
            <InputbarTools
              ref={inputbarToolsRef}
              assistant={assistant}
              model={model}
              files={files}
              extensions={supportedExts}
              setFiles={setFiles}
              showThinkingButton={showThinkingButton}
              showKnowledgeIcon={showKnowledgeIcon}
              selectedKnowledgeBases={selectedKnowledgeBases}
              handleKnowledgeBaseSelect={handleKnowledgeBaseSelect}
              setText={setText}
              resizeTextArea={resizeTextArea}
              mentionModels={mentionedModels}
              onMentionModel={onMentionModel}
              onClearMentionModels={onClearMentionModels}
              couldMentionNotVisionModel={couldMentionNotVisionModel}
              couldAddImageFile={couldAddImageFile}
              onEnableGenerateImage={onEnableGenerateImage}
              isExpanded={isExpanded}
              onToggleExpanded={onToggleExpanded}
              addNewTopic={addNewTopic}
              clearTopic={clearTopic}
              onNewContext={onNewContext}
              newTopicShortcut={newTopicShortcut}
              cleanTopicShortcut={cleanTopicShortcut}
            />
            <ToolbarMenu>
              <TokenCount
                estimateTokenCount={estimateTokenCount}
                inputTokenCount={inputTokenCount}
                contextCount={contextCount}
                ToolbarButton={ToolbarButton}
                onClick={onNewContext}
              />
              <TranslateButton text={text} onTranslated={onTranslated} isLoading={isTranslating} />
              <SendMessageButton sendMessage={sendMessage} disabled={inputEmpty} />
              {loading && (
                <Tooltip placement="top" title={t('chat.input.pause')} mouseLeaveDelay={0} arrow>
                  <ToolbarButton type="text" onClick={onPause} style={{ marginRight: -2 }}>
                    <CirclePause size={20} color="var(--color-error)" />
                  </ToolbarButton>
                </Tooltip>
              )}
            </ToolbarMenu>
          </Toolbar>
        </InputBarContainer>
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
  padding-top: 8px; // 为拖动手柄留出空间
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

const Toolbar = styled.div`
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

const ToolbarMenu = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

export const ToolbarButton = styled(Button)`
  width: 30px;
  height: 30px;
  font-size: 16px;
  border-radius: 50%;
  transition: all 0.3s ease;
  color: var(--color-icon);
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 0;
  &.anticon,
  &.iconfont {
    transition: all 0.3s ease;
    color: var(--color-icon);
  }
  .icon-a-addchat {
    font-size: 18px;
    margin-bottom: -2px;
  }
  &:hover {
    background-color: var(--color-background-soft);
    .anticon,
    .iconfont {
      color: var(--color-text-1);
    }
  }
  &.active {
    background-color: var(--color-primary) !important;
    .anticon,
    .iconfont,
    .chevron-icon {
      color: var(--color-white-soft);
    }
    &:hover {
      background-color: var(--color-primary);
    }
  }
`

export default Inputbar
