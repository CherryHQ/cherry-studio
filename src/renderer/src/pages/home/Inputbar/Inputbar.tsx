import {
  ClearOutlined,
  ColumnHeightOutlined,
  FormOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  GlobalOutlined,
  HolderOutlined,
  PauseCircleOutlined,
  PicCenterOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import TranslateButton from '@renderer/components/TranslateButton'
import { isVisionModel, isWebSearchModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { modelGenerating, useRuntime } from '@renderer/hooks/useRuntime'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut, useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { addAssistantMessagesToTopic, getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import { estimateTextTokens as estimateTxtTokens } from '@renderer/services/TokenService'
import { translateText } from '@renderer/services/TranslateService'
import WebSearchService from '@renderer/services/WebSearchService'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { sendMessage as _sendMessage } from '@renderer/store/messages'
import { setGenerating, setSearching } from '@renderer/store/runtime'
import { Assistant, FileType, KnowledgeBase, MCPServer, Message, Model, Topic } from '@renderer/types'
import { classNames, delay, getFileExtension } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { getFilesFromDropEvent } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Button, Popconfirm, Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import Logger from 'electron-log/renderer'
import { debounce, isEmpty } from 'lodash'
import React, { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import NarrowLayout from '../Messages/NarrowLayout'
import AttachmentButton from './AttachmentButton'
import AttachmentPreview from './AttachmentPreview'
import KnowledgeBaseButton from './KnowledgeBaseButton'
import MCPToolsButton from './MCPToolsButton'
import MentionModelsButton from './MentionModelsButton'
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

const Inputbar: FC<Props> = ({ assistant: _assistant, setActiveTopic }) => {
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
    clickAssistantToShowTopic,
    autoTranslateWithSpace
  } = useSettings()
  const [expended, setExpend] = useState(false)
  const [estimateTokenCount, setEstimateTokenCount] = useState(0)
  const [contextCount, setContextCount] = useState({ current: 0, max: 0 })
  const generating = useAppSelector((state) => state.runtime.generating)
  const textareaRef = useRef<TextAreaRef>(null)
  const [files, setFiles] = useState<FileType[]>(_files)
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const { searching } = useRuntime()
  const { isBubbleStyle } = useMessageStyle()
  const dispatch = useAppDispatch()
  const [spaceClickCount, setSpaceClickCount] = useState(0)
  const spaceClickTimer = useRef<NodeJS.Timeout>()
  const [isTranslating, setIsTranslating] = useState(false)
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [mentionModels, setMentionModels] = useState<Model[]>([])
  const [enabledMCPs, setEnabledMCPs] = useState<MCPServer[]>([])
  const [isMentionPopupOpen, setIsMentionPopupOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [textareaHeight, setTextareaHeight] = useState<number>()
  const startDragY = useRef<number>(0)
  const startHeight = useRef<number>(0)
  const currentMessageId = useRef<string>()
  const isVision = useMemo(() => isVisionModel(model), [model])
  const supportExts = useMemo(() => [...textExts, ...documentExts, ...(isVision ? imageExts : [])], [isVision])
  const navigate = useNavigate()

  const showKnowledgeIcon = useSidebarIconShow('knowledge')

  const [tokenCount, setTokenCount] = useState(0)

  const [mentionFromKeyboard, setMentionFromKeyboard] = useState(false)

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
  const newContextShortcut = useShortcutDisplay('toggle_new_context')
  const cleanTopicShortcut = useShortcutDisplay('clear_topic')
  const inputEmpty = isEmpty(text.trim()) && files.length === 0

  _text = text
  _files = files

  const sendMessage = useCallback(async () => {
    await modelGenerating()

    if (inputEmpty) {
      return
    }

    try {
      // Dispatch the sendMessage action with all options
      const uploadedFiles = await FileManager.uploadFiles(files)
      dispatch(
        _sendMessage(text, assistant, assistant.topics[0], {
          files: uploadedFiles,
          knowledgeBaseIds: selectedKnowledgeBases?.map((base) => base.id),
          mentionModels,
          enabledMCPs
        })
      )

      // Clear input
      setText('')
      setFiles([])
      setTimeout(() => setText(''), 500)
      setTimeout(() => resizeTextArea(), 0)
      setExpend(false)
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }, [inputEmpty, files, dispatch, text, assistant, selectedKnowledgeBases, mentionModels, enabledMCPs])

  const translate = async () => {
    if (isTranslating) {
      return
    }

    try {
      setIsTranslating(true)
      const translatedText = await translateText(text, targetLanguage)
      translatedText && setText(translatedText)
      setTimeout(() => resizeTextArea(), 0)
    } catch (error) {
      console.error('Translation failed:', error)
    } finally {
      setIsTranslating(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnterPressed = event.keyCode == 13

    if (event.key === '@') {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        const cursorPosition = textArea.selectionStart
        const textBeforeCursor = text.substring(0, cursorPosition)
        if (cursorPosition === 0 || textBeforeCursor.endsWith(' ')) {
          setMentionFromKeyboard(true)
          EventEmitter.emit(EVENT_NAMES.SHOW_MODEL_SELECTOR)
          setIsMentionPopupOpen(true)
          return
        }
      }
    }

    if (event.key === 'Escape' && isMentionPopupOpen) {
      setIsMentionPopupOpen(false)
      return
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
          console.log('Triple space detected - trigger translation')
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

    if (isEnterPressed && !event.shiftKey && sendMessageShortcut === 'Enter') {
      if (isMentionPopupOpen) {
        return event.preventDefault()
      }
      sendMessage()
      return event.preventDefault()
    }

    if (sendMessageShortcut === 'Shift+Enter' && isEnterPressed && event.shiftKey) {
      if (isMentionPopupOpen) {
        return event.preventDefault()
      }
      sendMessage()
      return event.preventDefault()
    }

    if (sendMessageShortcut === 'Ctrl+Enter' && isEnterPressed && event.ctrlKey) {
      if (isMentionPopupOpen) {
        return event.preventDefault()
      }
      sendMessage()
      return event.preventDefault()
    }

    if (sendMessageShortcut === 'Command+Enter' && isEnterPressed && event.metaKey) {
      if (isMentionPopupOpen) {
        return event.preventDefault()
      }
      sendMessage()
      return event.preventDefault()
    }

    if (event.key === 'Backspace' && text.trim() === '' && mentionModels.length > 0) {
      setMentionModels((prev) => prev.slice(0, -1))
      return event.preventDefault()
    }
  }

  const addNewTopic = useCallback(async () => {
    await modelGenerating()

    const topic = getDefaultTopic(assistant.id)

    await db.topics.add({ id: topic.id, messages: [] })
    await addAssistantMessagesToTopic({ assistant, topic })

    // Reset to assistant default model
    assistant.defaultModel && setModel(assistant.defaultModel)

    addTopic(topic)
    setActiveTopic(topic)

    clickAssistantToShowTopic && setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  }, [addTopic, assistant, clickAssistantToShowTopic, setActiveTopic, setModel])

  const clearTopic = async () => {
    if (generating) {
      onPause()
      await delay(1)
    }
    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES)
  }

  const onPause = () => {
    if (currentMessageId.current) {
      abortCompletion(currentMessageId.current)
    }
    window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, true)
    store.dispatch(setGenerating(false))
  }

  const onNewContext = () => {
    if (generating) return onPause()
    EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }

  const resizeTextArea = () => {
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      // 如果已经手动设置了高度,则不自动调整
      if (textareaHeight) {
        return
      }
      textArea.style.height = 'auto'
      textArea.style.height = textArea?.scrollHeight > 400 ? '400px' : `${textArea?.scrollHeight}px`
    }
  }

  const onToggleExpended = () => {
    const isExpended = !expended
    setExpend(isExpended)
    const textArea = textareaRef.current?.resizableTextArea?.textArea

    if (textArea) {
      if (isExpended) {
        textArea.style.height = '70vh'
      } else {
        resetHeight()
      }
    }

    textareaRef.current?.focus()
  }

  const onInput = () => !expended && resizeTextArea()

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)

    // Check if @ was deleted
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      const cursorPosition = textArea.selectionStart
      const textBeforeCursor = newText.substring(0, cursorPosition)
      const lastAtIndex = textBeforeCursor.lastIndexOf('@')

      if (lastAtIndex === -1 || textBeforeCursor.slice(lastAtIndex + 1).includes(' ')) {
        setIsMentionPopupOpen(false)
      }
    }
  }

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      const clipboardText = event.clipboardData?.getData('text')
      if (clipboardText) {
        // Prioritize the text when pasting.
        // handled by the default event
      } else {
        for (const file of event.clipboardData?.files || []) {
          event.preventDefault()

          if (file.path === '') {
            if (file.type.startsWith('image/') && isVisionModel(model)) {
              const tempFilePath = await window.api.file.create(file.name)
              const arrayBuffer = await file.arrayBuffer()
              const uint8Array = new Uint8Array(arrayBuffer)
              await window.api.file.write(tempFilePath, uint8Array)
              const selectedFile = await window.api.file.get(tempFilePath)
              selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
              break
            }
          }

          if (file.path) {
            if (supportExts.includes(getFileExtension(file.path))) {
              const selectedFile = await window.api.file.get(file.path)
              selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
            } else {
              window.message.info({
                key: 'file_not_supported',
                content: t('chat.input.file_not_supported')
              })
            }
          }
        }
      }

      if (pasteLongTextAsFile) {
        const item = event.clipboardData?.items[0]
        if (item && item.kind === 'string' && item.type === 'text/plain') {
          item.getAsString(async (pasteText) => {
            if (pasteText.length > pasteLongTextThreshold) {
              const tempFilePath = await window.api.file.create('pasted_text.txt')
              await window.api.file.write(tempFilePath, pasteText)
              const selectedFile = await window.api.file.get(tempFilePath)
              selectedFile && setFiles((prevFiles) => [...prevFiles, selectedFile])
              setText(text)
              setTimeout(() => resizeTextArea(), 0)
            }
          })
        }
      }
    },
    [pasteLongTextAsFile, pasteLongTextThreshold, supportExts, t, text]
  )

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const files = await getFilesFromDropEvent(e).catch((err) => {
      Logger.error('[src/renderer/src/pages/home/Inputbar/Inputbar.tsx] handleDrop:', err)
      return null
    })

    if (files) {
      files.forEach((file) => {
        if (supportExts.includes(getFileExtension(file.path))) {
          setFiles((prevFiles) => [...prevFiles, file])
        }
      })
    }
  }

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

  useShortcut('new_topic', () => {
    if (!generating) {
      addNewTopic()
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      textareaRef.current?.focus()
    }
  })

  useShortcut('clear_topic', () => {
    clearTopic()
  })

  useShortcut('toggle_new_context', () => {
    onNewContext()
  })

  useEffect(() => {
    const _setEstimateTokenCount = debounce(setEstimateTokenCount, 100, { leading: false, trailing: true })
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.EDIT_MESSAGE, (message: Message) => {
        setText(message.content)
        textareaRef.current?.focus()
        setTimeout(() => resizeTextArea(), 0)
      }),
      EventEmitter.on(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, ({ tokensCount, contextCount }) => {
        _setEstimateTokenCount(tokensCount)
        setContextCount({ current: contextCount.current, max: contextCount.max }) // 现在contextCount是一个对象而不是单个数值
      }),
      EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic),
      EventEmitter.on(EVENT_NAMES.QUOTE_TEXT, (quotedText: string) => {
        setText((prevText) => {
          const newText = prevText ? `${prevText}\n${quotedText}\n` : `${quotedText}\n`
          setTimeout(() => resizeTextArea(), 0)
          return newText
        })
        textareaRef.current?.focus()
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [addNewTopic])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [assistant])

  useEffect(() => {
    setTimeout(() => resizeTextArea(), 0)
  }, [])

  useEffect(() => {
    return () => {
      if (spaceClickTimer.current) {
        clearTimeout(spaceClickTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener('focus', () => {
      textareaRef.current?.focus()
    })
  }, [])

  useEffect(() => {
    // if assistant knowledge bases are undefined return []
    setSelectedKnowledgeBases(showKnowledgeIcon ? (assistant.knowledge_bases ?? []) : [])
  }, [assistant.id, assistant.knowledge_bases, showKnowledgeIcon])

  const textareaRows = window.innerHeight >= 1000 || isBubbleStyle ? 2 : 1

  const handleKnowledgeBaseSelect = (bases?: KnowledgeBase[]) => {
    updateAssistant({ ...assistant, knowledge_bases: bases })
    setSelectedKnowledgeBases(bases ?? [])
  }

  const onMentionModel = (model: Model, fromKeyboard: boolean = false) => {
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      if (fromKeyboard) {
        const cursorPosition = textArea.selectionStart
        const textBeforeCursor = text.substring(0, cursorPosition)
        const lastAtIndex = textBeforeCursor.lastIndexOf('@')

        if (lastAtIndex !== -1) {
          const newText = text.substring(0, lastAtIndex) + text.substring(cursorPosition)
          setText(newText)
        }
      }

      setMentionModels((prev) => [...prev, model])
      setIsMentionPopupOpen(false)
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 0)
      setMentionFromKeyboard(false)
    }
  }

  const handleRemoveModel = (model: Model) => {
    setMentionModels(mentionModels.filter((m) => m.id !== model.id))
  }

  const toggelEnableMCP = (mcp: MCPServer) => {
    setEnabledMCPs((prev) => {
      const exists = prev.some((item) => item.name === mcp.name)
      if (exists) {
        return prev.filter((item) => item.name !== mcp.name)
      } else {
        return [...prev, mcp]
      }
    })
  }

  const onEnableWebSearch = () => {
    console.log(assistant)
    if (!isWebSearchModel(model)) {
      if (!WebSearchService.isWebSearchEnabled()) {
        window.modal.confirm({
          title: t('chat.input.web_search.enable'),
          content: t('chat.input.web_search.enable_content'),
          centered: true,
          okText: t('chat.input.web_search.button.ok'),
          onOk: () => {
            navigate('/settings/web-search')
          }
        })
        return
      }
    }

    updateAssistant({ ...assistant, enableWebSearch: !assistant.enableWebSearch })
  }

  useEffect(() => {
    if (!isWebSearchModel(model) && !WebSearchService.isWebSearchEnabled() && assistant.enableWebSearch) {
      updateAssistant({ ...assistant, enableWebSearch: false })
    }
  }, [assistant, model, updateAssistant])

  const resetHeight = () => {
    if (expended) {
      setExpend(false)
    }
    setTextareaHeight(undefined)
    requestAnimationFrame(() => {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        textArea.style.height = 'auto'
        const contentHeight = textArea.scrollHeight
        textArea.style.height = contentHeight > 400 ? '400px' : `${contentHeight}px`
      }
    })
  }

  return (
    <Container onDragOver={handleDragOver} onDrop={handleDrop} className="inputbar">
      <NarrowLayout style={{ width: '100%' }}>
        <InputBarContainer
          id="inputbar"
          className={classNames('inputbar-container', inputFocus && 'focus')}
          ref={containerRef}>
          <AttachmentPreview files={files} setFiles={setFiles} />
          <MentionModelsInput selectedModels={mentionModels} onRemoveModel={handleRemoveModel} />
          <Textarea
            value={text}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={isTranslating ? t('chat.input.translating') : t('chat.input.placeholder')}
            autoFocus
            contextMenu="true"
            variant="borderless"
            spellCheck={false}
            rows={textareaRows}
            ref={textareaRef}
            style={{
              fontSize,
              height: textareaHeight ? `${textareaHeight}px` : undefined
            }}
            styles={{ textarea: TextareaStyle }}
            onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => {
              setInputFocus(true)
              const textArea = e.target
              if (textArea) {
                const length = textArea.value.length
                textArea.setSelectionRange(length, length)
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
            <ToolbarMenu>
              <Tooltip placement="top" title={t('chat.input.new_topic', { Command: newTopicShortcut })} arrow>
                <ToolbarButton type="text" onClick={addNewTopic}>
                  <FormOutlined />
                </ToolbarButton>
              </Tooltip>
              <MentionModelsButton
                mentionModels={mentionModels}
                onMentionModel={(model) => onMentionModel(model, mentionFromKeyboard)}
                ToolbarButton={ToolbarButton}
              />
              <Tooltip placement="top" title={t('chat.input.web_search')} arrow>
                <ToolbarButton type="text" onClick={onEnableWebSearch}>
                  <GlobalOutlined
                    style={{ color: assistant.enableWebSearch ? 'var(--color-link)' : 'var(--color-icon)' }}
                  />
                </ToolbarButton>
              </Tooltip>
              {showKnowledgeIcon && (
                <KnowledgeBaseButton
                  selectedBases={selectedKnowledgeBases}
                  onSelect={handleKnowledgeBaseSelect}
                  ToolbarButton={ToolbarButton}
                  disabled={files.length > 0}
                />
              )}
              <MCPToolsButton enabledMCPs={enabledMCPs} onEnableMCP={toggelEnableMCP} ToolbarButton={ToolbarButton} />
              <AttachmentButton model={model} files={files} setFiles={setFiles} ToolbarButton={ToolbarButton} />
              <Tooltip placement="top" title={t('chat.input.clear', { Command: cleanTopicShortcut })} arrow>
                <Popconfirm
                  title={t('chat.input.clear.content')}
                  placement="top"
                  onConfirm={clearTopic}
                  okButtonProps={{ danger: true }}
                  icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
                  okText={t('chat.input.clear.title')}>
                  <ToolbarButton type="text">
                    <ClearOutlined style={{ fontSize: 17 }} />
                  </ToolbarButton>
                </Popconfirm>
              </Tooltip>
              <Tooltip placement="top" title={t('chat.input.new.context', { Command: newContextShortcut })} arrow>
                <ToolbarButton type="text" onClick={onNewContext}>
                  <PicCenterOutlined />
                </ToolbarButton>
              </Tooltip>
              <Tooltip placement="top" title={expended ? t('chat.input.collapse') : t('chat.input.expand')} arrow>
                <ToolbarButton type="text" onClick={onToggleExpended}>
                  {expended ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                </ToolbarButton>
              </Tooltip>
              {textareaHeight && (
                <Tooltip placement="top" title={t('chat.input.auto_resize')} arrow>
                  <ToolbarButton type="text" onClick={resetHeight}>
                    <ColumnHeightOutlined />
                  </ToolbarButton>
                </Tooltip>
              )}
              <TokenCount
                estimateTokenCount={estimateTokenCount}
                inputTokenCount={inputTokenCount}
                contextCount={contextCount}
                ToolbarButton={ToolbarButton}
                onClick={onNewContext}
              />
            </ToolbarMenu>
            <ToolbarMenu>
              <TranslateButton text={text} onTranslated={onTranslated} isLoading={isTranslating} />
              {generating && (
                <Tooltip placement="top" title={t('chat.input.pause')} arrow>
                  <ToolbarButton type="text" onClick={onPause} style={{ marginRight: -2, marginTop: 1 }}>
                    <PauseCircleOutlined style={{ color: 'var(--color-error)', fontSize: 20 }} />
                  </ToolbarButton>
                </Tooltip>
              )}
              {!generating && <SendMessageButton sendMessage={sendMessage} disabled={generating || inputEmpty} />}
            </ToolbarMenu>
          </Toolbar>
        </InputBarContainer>
      </NarrowLayout>
    </Container>
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
`

const InputBarContainer = styled.div`
  border: 0.5px solid var(--color-border);
  transition: all 0.3s ease;
  position: relative;
  margin: 14px 20px;
  margin-top: 12px;
  border-radius: 15px;
  padding-top: 6px; // 为拖动手柄留出空间
  background-color: var(--color-background-opacity);
`

const TextareaStyle: CSSProperties = {
  paddingLeft: 0,
  padding: '4px 15px 8px' // 减小顶部padding
}

const Textarea = styled(TextArea)`
  padding: 0;
  border-radius: 0;
  display: flex;
  flex: 1;
  font-family: Ubuntu;
  resize: none !important;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  &.ant-input {
    line-height: 1.4;
  }
`

const Toolbar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 0 8px;
  padding-bottom: 0;
  margin-bottom: 4px;
  height: 36px;
`

const ToolbarMenu = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`

const ToolbarButton = styled(Button)`
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
    .iconfont {
      color: var(--color-white-soft);
    }
    &:hover {
      background-color: var(--color-primary);
    }
  }
`

export default Inputbar
