import { HolderOutlined } from '@ant-design/icons'
import { QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import TranslateButton from '@renderer/components/TranslateButton'
import Logger from '@renderer/config/logger'
import {
  isGenerateImageModel,
  isGenerateImageModels,
  isSupportedDisableGenerationModel,
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
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import { checkRateLimit, getUserMessage } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import PasteService from '@renderer/services/PasteService'
import { estimateTextTokens as estimateTxtTokens, estimateUserPromptUsage } from '@renderer/services/TokenService'
import { translateText } from '@renderer/services/TranslateService'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSearching } from '@renderer/store/runtime'
import { sendMessage as _sendMessage } from '@renderer/store/thunk/messageThunk'
import { Assistant, FileType, FileTypes, KnowledgeBase, KnowledgeItem, Model, Topic } from '@renderer/types'
import type { MessageInputBaseParams } from '@renderer/types/newMessage'
import { classNames, delay, formatFileSize, getFileExtension } from '@renderer/utils'
import { formatQuotedText } from '@renderer/utils/formats'
import { getFilesFromDropEvent, getSendMessageShortcutLabel, isSendMessageKeyPressed } from '@renderer/utils/input'
import { getLanguageByLangcode } from '@renderer/utils/translate'
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
import KnowledgeBaseInput from './KnowledgeBaseInput'
import MentionModelsInput from './MentionModelsInput'
import SendMessageButton from './SendMessageButton'
import TokenCount from './TokenCount'

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
    enableBackspaceDeleteModel,
    enableSpellCheck
  } = useSettings()
  const [expended, setExpend] = useState(false)
  const [estimateTokenCount, setEstimateTokenCount] = useState(0)
  const [contextCount, setContextCount] = useState({ current: 0, max: 0 })
  const textareaRef = useRef<TextAreaRef>(null)
  const [files, setFiles] = useState<FileType[]>(_files)
  const { t } = useTranslation()
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
  const currentMessageId = useRef<string>('')
  const { bases: knowledgeBases } = useKnowledgeBases()
  const isMultiSelectMode = useAppSelector((state) => state.runtime.chat.isMultiSelectMode)
  const isVisionAssistant = useMemo(() => isVisionModel(model), [model])
  const isGenerateImageAssistant = useMemo(() => isGenerateImageModel(model), [model])

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
    if (inputEmpty || loading) {
      return
    }
    if (checkRateLimit(assistant)) {
      return
    }

    Logger.log('[DEBUG] Starting to send message')

    EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE)

    try {
      // Dispatch the sendMessage action with all options
      const uploadedFiles = await FileManager.uploadFiles(files)

      const baseUserMessage: MessageInputBaseParams = { assistant, topic, content: text }
      Logger.log('baseUserMessage', baseUserMessage)

      // getUserMessage()
      if (uploadedFiles) {
        baseUserMessage.files = uploadedFiles
      }

      if (mentionedModels) {
        baseUserMessage.mentions = mentionedModels
      }

      const assistantWithTopicPrompt = topic.prompt
        ? { ...assistant, prompt: `${assistant.prompt}\n${topic.prompt}` }
        : assistant

      baseUserMessage.usage = await estimateUserPromptUsage(baseUserMessage)

      const { message, blocks } = getUserMessage(baseUserMessage)

      currentMessageId.current = message.id
      dispatch(_sendMessage(message, blocks, assistantWithTopicPrompt, topic.id))

      // Clear input
      setText('')
      setFiles([])
      setTimeout(() => setText(''), 500)
      setTimeout(() => resizeTextArea(), 0)
      setExpend(false)
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }, [assistant, dispatch, files, inputEmpty, loading, mentionedModels, resizeTextArea, text, topic])

  const translate = useCallback(async () => {
    if (isTranslating) {
      return
    }

    try {
      setIsTranslating(true)
      const translatedText = await translateText(text, getLanguageByLangcode(targetLanguage))
      translatedText && setText(translatedText)
      setTimeout(() => resizeTextArea(), 0)
    } catch (error) {
      console.error('Translation failed:', error)
    } finally {
      setIsTranslating(false)
    }
  }, [isTranslating, text, targetLanguage, resizeTextArea])

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
      title: t('chat.input.upload'),
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
          Logger.log('Triple space detected - trigger translation')
          setSpaceClickCount(0)
          setIsTranslating(true)
          translate()
          return
        }
      }
    }

    if (expended) {
      if (event.key === 'Escape') {
        return onToggleExpended()
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
            setTimeout(() => {
              textArea.selectionStart = textArea.selectionEnd = start + 1
              onInput() // trigger resizeTextArea
            }, 0)
          }
        }
      }
    }

    if (enableBackspaceDeleteModel && event.key === 'Backspace' && text.trim() === '' && mentionedModels.length > 0) {
      setMentionedModels((prev) => prev.slice(0, -1))
      return event.preventDefault()
    }

    if (enableBackspaceDeleteModel && event.key === 'Backspace' && text.trim() === '' && files.length > 0) {
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

    setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  }, [addTopic, assistant, setActiveTopic, setModel])

  const onQuote = useCallback(
    (text: string) => {
      const quotedText = formatQuotedText(text)
      setText((prevText) => {
        const newText = prevText ? `${prevText}\n${quotedText}\n` : `${quotedText}\n`
        setTimeout(() => resizeTextArea(), 0)
        return newText
      })
      textareaRef.current?.focus()
    },
    [resizeTextArea]
  )

  const onPause = async () => {
    await pauseMessages()
  }

  const clearTopic = async () => {
    if (loading) {
      await onPause()
      await delay(1)
    }
    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES)
  }

  const onNewContext = () => {
    if (loading) {
      onPause()
      return
    }
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }

  const onInput = () => !expended && resizeTextArea()

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value
      setText(newText)

      const textArea = textareaRef.current?.resizableTextArea?.textArea
      const cursorPosition = textArea?.selectionStart ?? 0
      const lastSymbol = newText[cursorPosition - 1]

      if (enableQuickPanelTriggers && !quickPanel.isVisible && lastSymbol === '/') {
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

      if (enableQuickPanelTriggers && !quickPanel.isVisible && lastSymbol === '@') {
        inputbarToolsRef.current?.openMentionModelsPanel()
      }
    },
    [enableQuickPanelTriggers, quickPanel, t, files, couldAddImageFile, openSelectFileMenu, translate]
  )

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      return await PasteService.handlePaste(
        event,
        isVisionModel(model),
        isGenerateImageModel(model),
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
    [model, pasteLongTextAsFile, pasteLongTextThreshold, resizeTextArea, supportedExts, t, text]
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

      const files = await getFilesFromDropEvent(e).catch((err) => {
        Logger.error('[Inputbar] handleDrop:', err)
        return null
      })

      if (files) {
        let supportedFiles = 0

        files.forEach((file) => {
          if (supportedExts.includes(getFileExtension(file.path))) {
            setFiles((prevFiles) => [...prevFiles, file])
            supportedFiles++
          }
        })

        // 如果有文件，但都不支持
        if (files.length > 0 && supportedFiles === 0) {
          window.message.info({
            key: 'file_not_supported',
            content: t('chat.input.file_not_supported')
          })
        }
      }
    },
    [supportedExts, t]
  )

  const onTranslated = (translatedText: string) => {
    setText(translatedText)
    setTimeout(() => resizeTextArea(), 0)
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
        setExpend(newHeight == maxHeightInPixels)
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
    textareaRef.current?.focus()
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
      textareaRef.current?.focus()
    }
  }, [assistant, topic])

  useEffect(() => {
    setTimeout(() => resizeTextArea(), 0)
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
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    // if assistant knowledge bases are undefined return []
    setSelectedKnowledgeBases(showKnowledgeIcon ? (assistant.knowledge_bases ?? []) : [])
  }, [assistant.id, assistant.knowledge_bases, showKnowledgeIcon])

  const handleKnowledgeBaseSelect = (bases?: KnowledgeBase[]) => {
    updateAssistant({ ...assistant, knowledge_bases: bases })
    setSelectedKnowledgeBases(bases ?? [])
  }

  const handleRemoveModel = (model: Model) => {
    setMentionedModels(mentionedModels.filter((m) => m.id !== model.id))
  }

  const handleRemoveKnowledgeBase = (knowledgeBase: KnowledgeBase) => {
    const newKnowledgeBases = assistant.knowledge_bases?.filter((kb) => kb.id !== knowledgeBase.id)
    updateAssistant({
      ...assistant,
      knowledge_bases: newKnowledgeBases
    })
    setSelectedKnowledgeBases(newKnowledgeBases ?? [])
  }

  const onEnableGenerateImage = () => {
    updateAssistant({ ...assistant, enableGenerateImage: !assistant.enableGenerateImage })
  }

  useEffect(() => {
    if (!isWebSearchModel(model) && assistant.enableWebSearch) {
      updateAssistant({ ...assistant, enableWebSearch: false })
    }
    if (assistant.webSearchProviderId && !WebSearchService.isWebSearchEnabled(assistant.webSearchProviderId)) {
      updateAssistant({ ...assistant, webSearchProviderId: undefined })
    }
    if (!isGenerateImageModel(model) && assistant.enableGenerateImage) {
      updateAssistant({ ...assistant, enableGenerateImage: false })
    }
    if (isGenerateImageModel(model) && !assistant.enableGenerateImage && !isSupportedDisableGenerationModel(model)) {
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
        console.error('在已上传图片时，不能添加非视觉模型')
      }
    },
    [couldMentionNotVisionModel]
  )

  const onToggleExpended = () => {
    const currentlyExpanded = expended || !!textareaHeight
    const shouldExpand = !currentlyExpanded
    setExpend(shouldExpand)
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

    textareaRef.current?.focus()
  }

  const isExpended = expended || !!textareaHeight
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
          {selectedKnowledgeBases.length > 0 && (
            <KnowledgeBaseInput
              selectedKnowledgeBases={selectedKnowledgeBases}
              onRemoveKnowledgeBase={handleRemoveKnowledgeBase}
            />
          )}
          {mentionedModels.length > 0 && (
            <MentionModelsInput selectedModels={mentionedModels} onRemoveModel={handleRemoveModel} />
          )}
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
            onClick={() => searching && dispatch(setSearching(false))}
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
              couldMentionNotVisionModel={couldMentionNotVisionModel}
              couldAddImageFile={couldAddImageFile}
              onEnableGenerateImage={onEnableGenerateImage}
              isExpended={isExpended}
              onToggleExpended={onToggleExpended}
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
              {loading && (
                <Tooltip placement="top" title={t('chat.input.pause')} arrow>
                  <ToolbarButton type="text" onClick={onPause} style={{ marginRight: -2, marginTop: 1 }}>
                    <CirclePause style={{ color: 'var(--color-error)', fontSize: 20 }} />
                  </ToolbarButton>
                </Tooltip>
              )}
              {!loading && <SendMessageButton sendMessage={sendMessage} disabled={loading || inputEmpty} />}
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
  padding: 0 16px 16px 16px;
`

const InputBarContainer = styled.div`
  border: 0.5px solid var(--color-border);
  transition: all 0.2s ease;
  position: relative;
  border-radius: 15px;
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
