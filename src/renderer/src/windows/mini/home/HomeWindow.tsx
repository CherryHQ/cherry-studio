import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultTopic } from '@renderer/services/AssistantService'
import { ConversationService } from '@renderer/services/ConversationService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import { useAppSelector } from '@renderer/store'
import { IpcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Assistant, Message, Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType
} from '@renderer/types/newMessage'
import { abortCompletion, addAbortController, removeAbortController } from '@renderer/utils/abortController'
import { blocksToParts } from '@renderer/utils/blocksToparts'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import { findAllBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import { defaultLanguage } from '@shared/config/constant'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessage, UIMessageChunk } from 'ai'
import { Divider } from 'antd'
import { cloneDeep, isEmpty } from 'lodash'
import { last } from 'lodash'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChatWindow from '../chat/ChatWindow'
import TranslateWindow from '../translate/TranslateWindow'
import ClipboardPreview from './components/ClipboardPreview'
import type { FeatureMenusRef } from './components/FeatureMenus'
import FeatureMenus from './components/FeatureMenus'
import Footer from './components/Footer'
import InputBar from './components/InputBar'

const logger = loggerService.withContext('HomeWindow')
const transport = new IpcChatTransport()

type MainStreamChunk = UIMessageChunk & {
  delta?: string
  text?: string
  error?: unknown
}

const resolveChunkText = (chunk: MainStreamChunk): string => {
  if (typeof chunk.delta === 'string') return chunk.delta
  if (typeof chunk.text === 'string') return chunk.text
  return ''
}

const toError = (error: unknown): Error => {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  return new Error('Unknown stream error')
}

const buildPartsFromBlocks = (blocks: MessageBlock[]): CherryMessagePart[] => {
  const parts = blocksToParts(blocks)

  return parts.map((part, index) => {
    const block = blocks[index]
    if (!block) return part

    if (part.type === 'reasoning' && block.type === MessageBlockType.THINKING) {
      return {
        ...part,
        providerMetadata: {
          ...part.providerMetadata,
          cherry: {
            thinkingMs: block.thinking_millsec
          }
        }
      } as CherryMessagePart
    }

    return part
  })
}

const buildRuntimeAssistantOverrides = (assistant: Assistant) => ({
  prompt: assistant.prompt,
  settings: assistant.settings,
  enableWebSearch: assistant.enableWebSearch ?? false,
  webSearchProviderId: assistant.webSearchProviderId,
  enableUrlContext: assistant.enableUrlContext,
  enableGenerateImage: assistant.enableGenerateImage
})

const toUIMessage = (message: Message, partsMap: Record<string, CherryMessagePart[]>): UIMessage => {
  const mappedParts = partsMap[message.id]
  if (mappedParts && mappedParts.length > 0) {
    return {
      id: message.id,
      role: message.role,
      parts: mappedParts as UIMessage['parts']
    } as UIMessage
  }

  const blocks = findAllBlocks(message)
  const parts = blocksToParts(blocks) as UIMessage['parts']
  const fallbackText = mappedParts ? getTextFromParts(mappedParts) : getMainTextContent(message)
  return {
    id: message.id,
    role: message.role,
    parts: parts.length > 0 ? parts : ([{ type: 'text', text: fallbackText || '' }] as UIMessage['parts'])
  } as UIMessage
}

const HomeWindow: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const [readClipboardAtStartup] = usePreference('feature.quick_assistant.read_clipboard_at_startup')
  const [language] = usePreference('app.language')
  const [windowStyle] = usePreference('ui.window_style')
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [route, setRoute] = useState<'home' | 'chat' | 'translate' | 'summary' | 'explanation'>('home')
  const [isFirstMessage, setIsFirstMessage] = useState(true)

  const [userInputText, setUserInputText] = useState('')

  const [clipboardText, setClipboardText] = useState('')
  const lastClipboardTextRef = useRef<string | null>(null)

  const [isPinned, setIsPinned] = useState(false)

  // Indicator for loading(thinking/streaming)
  const [isLoading, setIsLoading] = useState(false)
  // Indicator for whether the first message is outputted
  const [isOutputted, setIsOutputted] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const { quickAssistantId } = useAppSelector((state) => state.llm)
  const { assistant: currentAssistant } = useAssistant(quickAssistantId)

  const currentTopic = useRef<Topic>(getDefaultTopic(currentAssistant.id))
  const currentAskId = useRef('')
  const [sessionMessages, setSessionMessages] = useState<Message[]>([])
  const [partsMap, setPartsMap] = useState<Record<string, CherryMessagePart[]>>({})
  const sessionMessagesRef = useRef<Message[]>([])
  const partsMapRef = useRef<Record<string, CherryMessagePart[]>>({})

  const inputBarRef = useRef<HTMLDivElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)

  const syncSessionState = useCallback((nextMessages: Message[], nextPartsMap: Record<string, CherryMessagePart[]>) => {
    sessionMessagesRef.current = nextMessages
    partsMapRef.current = nextPartsMap
    setSessionMessages(nextMessages)
    setPartsMap(nextPartsMap)
  }, [])

  const referenceText = useMemo(() => clipboardText || userInputText, [clipboardText, userInputText])

  const userContent = useMemo(() => {
    if (isFirstMessage) {
      return referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`.trim()
    }
    return userInputText.trim()
  }, [isFirstMessage, referenceText, userInputText])

  useEffect(() => {
    void i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  // Reset state when switching to home route
  useEffect(() => {
    if (route === 'home') {
      setIsFirstMessage(true)
      setError(null)
      syncSessionState([], {})
    }
  }, [route, syncSessionState])

  const focusInput = useCallback(() => {
    if (inputBarRef.current) {
      const input = inputBarRef.current.querySelector('input')
      if (input) {
        input.focus()
      }
    }
  }, [])

  // Use useCallback with stable dependencies to avoid infinite loops
  const readClipboard = useCallback(async () => {
    if (!readClipboardAtStartup || !document.hasFocus()) return

    try {
      const text = await navigator.clipboard.readText()
      if (text && text !== lastClipboardTextRef.current) {
        lastClipboardTextRef.current = text
        setClipboardText(text.trim())
      }
    } catch (error) {
      // Silently handle clipboard read errors (common in some environments)
      logger.warn('Failed to read clipboard:', error as Error)
    }
  }, [readClipboardAtStartup])

  const clearClipboard = useCallback(async () => {
    setClipboardText('')
    lastClipboardTextRef.current = null
    focusInput()
  }, [focusInput])

  const onWindowShow = useCallback(async () => {
    await readClipboard()
    focusInput()
  }, [readClipboard, focusInput])

  useEffect(() => {
    void window.api.miniWindow.setPin(isPinned)
  }, [isPinned])

  useEffect(() => {
    window.electron.ipcRenderer.on(IpcChannel.ShowMiniWindow, onWindowShow)

    return () => {
      window.electron.ipcRenderer.removeAllListeners(IpcChannel.ShowMiniWindow)
    }
  }, [onWindowShow])

  useEffect(() => {
    void readClipboard()
  }, [readClipboard])

  const handleCloseWindow = useCallback(() => window.api.miniWindow.hide(), [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 使用非直接输入法时（例如中文、日文输入法），存在输入法键入过程
    // 键入过程不应有任何响应
    // 例子，中文输入法候选词过程使用`Enter`直接上屏字母，日文输入法候选词过程使用`Enter`输入假名
    // 输入法可以`Esc`终止候选词过程
    // 这两个例子的`Enter`和`Esc`快捷助手都不应该响应
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return
    }

    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        {
          if (isLoading) return

          e.preventDefault()
          if (userContent) {
            if (route === 'home') {
              featureMenusRef.current?.useFeature()
            } else {
              // Currently text input is only available in 'chat' mode
              setRoute('chat')
              void handleSendMessage()
              focusInput()
            }
          }
        }
        break
      case 'Backspace':
        {
          if (userInputText.length === 0) {
            void clearClipboard()
          }
        }
        break
      case 'ArrowUp':
        {
          if (route === 'home') {
            e.preventDefault()
            featureMenusRef.current?.prevFeature()
          }
        }
        break
      case 'ArrowDown':
        {
          if (route === 'home') {
            e.preventDefault()
            featureMenusRef.current?.nextFeature()
          }
        }
        break
      case 'Escape':
        {
          handleEsc()
        }
        break
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserInputText(e.target.value)
  }

  const handleError = (error: Error) => {
    setIsLoading(false)
    setError(error.message)
  }

  const handleSendMessage = useCallback(
    async (prompt?: string) => {
      if (isEmpty(userContent) || !currentTopic.current) {
        return
      }

      try {
        const topicId = currentTopic.current.id

        const { message: userMessage, blocks } = getUserMessage({
          content: [prompt, userContent].filter(Boolean).join('\n\n'),
          assistant: currentAssistant,
          topic: currentTopic.current
        })
        const userParts = buildPartsFromBlocks(blocks)

        const assistantMessage = getAssistantMessage({
          assistant: currentAssistant,
          topic: currentTopic.current
        })
        assistantMessage.askId = userMessage.id
        currentAskId.current = userMessage.id
        let currentAssistantMessage = assistantMessage

        const nextMessages = [...sessionMessagesRef.current, userMessage, assistantMessage]
        const nextPartsMap = {
          ...partsMapRef.current,
          [userMessage.id]: userParts,
          [assistantMessage.id]: []
        }
        syncSessionState(nextMessages, nextPartsMap)

        const messagesForContext = nextMessages.filter((message) => message && !message.status?.includes('ing'))
        let assistantBlocks: MessageBlock[] = []
        let blockId: string | null = null
        let thinkingBlockId: string | null = null
        let thinkingStartTime: number | null = null

        const resolveThinkingDuration = (duration?: number) => {
          if (typeof duration === 'number' && Number.isFinite(duration)) {
            return duration
          }
          if (thinkingStartTime !== null) {
            return Math.max(0, performance.now() - thinkingStartTime)
          }
          return 0
        }

        setIsLoading(true)
        setIsOutputted(false)
        setError(null)

        setIsFirstMessage(false)
        setUserInputText('')

        const newAssistant = cloneDeep(currentAssistant)
        if (!newAssistant.settings) {
          newAssistant.settings = {}
        }
        newAssistant.settings.streamOutput = true
        // 显式关闭这些功能
        newAssistant.webSearchProviderId = undefined
        newAssistant.mcpServers = undefined
        newAssistant.knowledge_bases = undefined

        const { contextCount } = getAssistantSettings(newAssistant)
        const filteredMessages = ConversationService.filterMessagesPipeline(messagesForContext, contextCount)
        const contextMessages = filteredMessages.length > 0 ? filteredMessages : [userMessage]
        const uiMessages = contextMessages.map((message) => toUIMessage(message, nextPartsMap))
        const model = newAssistant.model

        const emitAssistantUpdate = (updates?: Partial<Message>) => {
          currentAssistantMessage = {
            ...currentAssistantMessage,
            ...updates,
            blocks: assistantBlocks.map((block) => block.id)
          }
          const updatedMessages = nextMessages.map((message) =>
            message.id === currentAssistantMessage.id ? currentAssistantMessage : message
          )
          const updatedPartsMap = {
            ...partsMapRef.current,
            [userMessage.id]: userParts,
            [currentAssistantMessage.id]: buildPartsFromBlocks(assistantBlocks)
          }
          syncSessionState(updatedMessages, updatedPartsMap)
        }

        const upsertAssistantBlock = (block: MessageBlock) => {
          const blockIndex = assistantBlocks.findIndex((item) => item.id === block.id)
          if (blockIndex >= 0) {
            assistantBlocks = assistantBlocks.map((item, index) => (index === blockIndex ? block : item))
          } else {
            assistantBlocks = [...assistantBlocks, block]
          }
        }

        const updateAssistantBlock = (targetId: string, changes: Partial<MessageBlock>) => {
          assistantBlocks = assistantBlocks.map((block) =>
            block.id === targetId
              ? ({
                  ...block,
                  ...changes
                } as MessageBlock)
              : block
          )
        }

        const finalizeInterruptedStream = (streamError: Error) => {
          const isAborted = isAbortError(streamError)
          const possibleBlockId = thinkingBlockId || blockId
          if (possibleBlockId) {
            updateAssistantBlock(possibleBlockId, {
              status: isAborted ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
            })
          }
          emitAssistantUpdate({
            status: isAborted ? AssistantMessageStatus.PAUSED : AssistantMessageStatus.ERROR
          })
          setIsLoading(false)
          setIsOutputted(true)
          currentAskId.current = ''
          thinkingStartTime = null
          thinkingBlockId = null
          blockId = null
        }

        const abortController = new AbortController()
        const abortFn = () => abortController.abort()
        addAbortController(userMessage.id, abortFn)

        try {
          if (!model) {
            throw new Error('Assistant model is required.')
          }

          const stream = await transport.sendMessages({
            trigger: 'submit-message',
            chatId: topicId,
            messageId: undefined,
            messages: uiMessages,
            abortSignal: abortController.signal,
            body: {
              topicId,
              assistantId: newAssistant.id,
              providerId: model.provider,
              modelId: model.id,
              mcpToolIds: [],
              assistantOverrides: buildRuntimeAssistantOverrides(newAssistant)
            } as Record<string, unknown>
          })

          let textContent = ''
          let reasoningContent = ''
          const reader = stream.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const chunk = value as MainStreamChunk

              switch (chunk.type) {
                case 'reasoning-start':
                  {
                    setIsOutputted(true)
                    thinkingStartTime = performance.now()
                    if (thinkingBlockId) {
                      updateAssistantBlock(thinkingBlockId, { status: MessageBlockStatus.STREAMING })
                    } else {
                      const block = createThinkingBlock(assistantMessage.id, '', {
                        status: MessageBlockStatus.STREAMING
                      })
                      thinkingBlockId = block.id
                      upsertAssistantBlock(block)
                    }
                    emitAssistantUpdate()
                  }
                  break
                case 'reasoning-delta':
                  {
                    const delta = resolveChunkText(chunk)
                    if (!delta) break
                    setIsOutputted(true)
                    reasoningContent += delta
                    if (thinkingBlockId) {
                      if (thinkingStartTime === null) {
                        thinkingStartTime = performance.now()
                      }
                      const thinkingDuration = resolveThinkingDuration(undefined)
                      updateAssistantBlock(thinkingBlockId, {
                        content: reasoningContent,
                        thinking_millsec: thinkingDuration
                      })
                      emitAssistantUpdate()
                    }
                  }
                  break
                case 'reasoning-end':
                  {
                    if (thinkingBlockId) {
                      const thinkingDuration = resolveThinkingDuration(undefined)
                      updateAssistantBlock(thinkingBlockId, {
                        content: reasoningContent,
                        status: MessageBlockStatus.SUCCESS,
                        thinking_millsec: thinkingDuration
                      })
                      emitAssistantUpdate()
                    }
                    thinkingStartTime = null
                    thinkingBlockId = null
                  }
                  break
                case 'text-start':
                  {
                    setIsOutputted(true)
                    if (blockId) {
                      updateAssistantBlock(blockId, { status: MessageBlockStatus.STREAMING })
                    } else {
                      const block = createMainTextBlock(assistantMessage.id, '', {
                        status: MessageBlockStatus.STREAMING
                      })
                      blockId = block.id
                      upsertAssistantBlock(block)
                    }
                    emitAssistantUpdate()
                  }
                  break
                case 'text-delta':
                  {
                    const delta = resolveChunkText(chunk)
                    if (!delta) break
                    setIsOutputted(true)
                    textContent += delta
                    if (blockId) {
                      updateAssistantBlock(blockId, { content: textContent })
                      emitAssistantUpdate()
                    }
                  }
                  break
                case 'text-end':
                  {
                    if (blockId) {
                      updateAssistantBlock(blockId, {
                        content: textContent,
                        status: MessageBlockStatus.SUCCESS
                      })
                      emitAssistantUpdate()
                    }
                  }
                  break
                case 'abort':
                case 'error': {
                  const streamError =
                    chunk.type === 'abort'
                      ? new DOMException('Request was aborted', 'AbortError')
                      : toError(chunk.error)
                  const isAborted = isAbortError(streamError)
                  finalizeInterruptedStream(streamError)
                  if (!isAborted) {
                    throw streamError
                  }
                  break
                }
                case 'finish':
                  setIsLoading(false)
                  setIsOutputted(true)
                  currentAskId.current = ''
                  emitAssistantUpdate({ status: AssistantMessageStatus.SUCCESS })
                  break
                default:
              }
            }
            if (abortController.signal.aborted) {
              finalizeInterruptedStream(new DOMException('Request was aborted', 'AbortError'))
            }
          } finally {
            reader.releaseLock()
          }
        } finally {
          removeAbortController(userMessage.id, abortFn)
        }
      } catch (err) {
        if (isAbortError(err)) return
        handleError(err instanceof Error ? err : new Error('An error occurred'))
        logger.error('Error fetching result:', err as Error)
      } finally {
        setIsLoading(false)
        setIsOutputted(true)
        currentAskId.current = ''
      }
    },
    [currentAssistant, syncSessionState, userContent]
  )

  const handlePause = useCallback(() => {
    if (currentAskId.current) {
      abortCompletion(currentAskId.current)
      setIsLoading(false)
      setIsOutputted(true)
      currentAskId.current = ''
    }
  }, [])

  const handleEsc = useCallback(() => {
    if (isLoading) {
      handlePause()
    } else {
      if (route === 'home') {
        void handleCloseWindow()
      } else {
        // Reset the topic
        currentTopic.current = getDefaultTopic(currentAssistant.id)
        syncSessionState([], {})

        // Reset selection only after using a feature and returning to home.
        featureMenusRef.current?.resetSelectedIndex()
        setError(null)
        setRoute('home')
        setUserInputText('')
      }
    }
  }, [currentAssistant.id, handleCloseWindow, handlePause, isLoading, route, syncSessionState])

  const handleCopy = useCallback(() => {
    if (!currentTopic.current) return
    const lastMessage = last(sessionMessagesRef.current)

    if (lastMessage) {
      const content = partsMapRef.current[lastMessage.id]
        ? getTextFromParts(partsMapRef.current[lastMessage.id])
        : getMainTextContent(lastMessage)
      void navigator.clipboard.writeText(content)
      window.toast.success(t('message.copy.success'))
    }
  }, [t])

  const backgroundColor = useMemo(() => {
    // ONLY MAC: when transparent style + light theme: use vibrancy effect
    // because the dark style under mac's vibrancy effect has not been implemented
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }
    return 'var(--color-background)'
  }, [windowStyle, theme])

  // Memoize placeholder text
  const inputPlaceholder = useMemo(() => {
    if (referenceText && route === 'home') {
      return t('miniwindow.input.placeholder.title')
    }
    return t('miniwindow.input.placeholder.empty', {
      model: quickAssistantId ? currentAssistant.name : currentAssistant.model.name
    })
  }, [referenceText, route, t, quickAssistantId, currentAssistant])

  // Memoize footer props
  const baseFooterProps = useMemo(
    () => ({
      route,
      loading: isLoading,
      onEsc: handleEsc,
      setIsPinned,
      isPinned
    }),
    [route, isLoading, handleEsc, isPinned]
  )

  switch (route) {
    case 'chat':
    case 'summary':
    case 'explanation':
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          {route === 'chat' && (
            <>
              <InputBar
                text={userInputText}
                assistant={currentAssistant}
                referenceText={referenceText}
                placeholder={inputPlaceholder}
                loading={isLoading}
                handleKeyDown={handleKeyDown}
                handleChange={handleChange}
                ref={inputBarRef}
              />
              <Divider style={{ margin: '10px 0' }} />
            </>
          )}
          {['summary', 'explanation'].includes(route) && (
            <div style={{ marginTop: 10 }}>
              <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
            </div>
          )}
          <ChatWindow
            route={route}
            assistant={currentAssistant}
            isOutputted={isOutputted}
            messages={sessionMessages}
            partsMap={partsMap}
          />
          {error && <ErrorMsg>{error}</ErrorMsg>}

          <Divider style={{ margin: '10px 0' }} />
          <Footer key="footer" {...baseFooterProps} onCopy={handleCopy} />
        </Container>
      )

    case 'translate':
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          <TranslateWindow text={referenceText} />
          <Divider style={{ margin: '10px 0' }} />
          <Footer key="footer" {...baseFooterProps} />
        </Container>
      )

    // Home
    default:
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          <InputBar
            text={userInputText}
            assistant={currentAssistant}
            referenceText={referenceText}
            placeholder={inputPlaceholder}
            loading={isLoading}
            handleKeyDown={handleKeyDown}
            handleChange={handleChange}
            ref={inputBarRef}
          />
          <Divider style={{ margin: '10px 0' }} />
          <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
          <Main>
            <FeatureMenus
              setRoute={setRoute}
              onSendMessage={handleSendMessage}
              text={userContent}
              ref={featureMenusRef}
            />
          </Main>
          <Divider style={{ margin: '10px 0' }} />
          <Footer
            key="footer"
            {...baseFooterProps}
            canUseBackspace={userInputText.length > 0 || clipboardText.length === 0}
            clearClipboard={clearClipboard}
          />
        </Container>
      )
  }
}

const Container = styled.div<{ $draggable: boolean }>`
  display: flex;
  flex: 1;
  height: 100%;
  width: 100%;
  flex-direction: column;
  -webkit-app-region: ${({ $draggable }) => ($draggable ? 'drag' : 'no-drag')};
  padding: 8px 10px;
`

const Main = styled.main`
  display: flex;
  flex-direction: column;

  flex: 1;
  overflow: hidden;
`

const ErrorMsg = styled.div`
  color: var(--color-error);
  background: rgba(255, 0, 0, 0.15);
  border: 1px solid var(--color-error);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  word-break: break-all;
`

export default HomeWindow
