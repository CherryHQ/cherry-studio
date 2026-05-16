import { useChat } from '@ai-sdk/react'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useExecutionChats } from '@renderer/hooks/useExecutionChats'
import { collectLiveAssistants, useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import { useDefaultModel } from '@renderer/hooks/useModels'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import i18n from '@renderer/i18n'
import ExecutionStreamCollector from '@renderer/pages/home/Messages/ExecutionStreamCollector'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import { defaultLanguage } from '@shared/config/constant'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { IpcChannel } from '@shared/IpcChannel'
import { Divider } from 'antd'
import { isEmpty } from 'lodash'
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

type MiniRoute = 'home' | 'chat' | 'translate' | 'summary' | 'explanation'

const HomeWindow: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const [readClipboardAtStartup] = usePreference('feature.quick_assistant.read_clipboard_at_startup')
  const [quickAssistantId] = usePreference('feature.quick_assistant.assistant_id')
  const [language] = usePreference('app.language')
  const [windowStyle] = usePreference('ui.window_style')
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [route, setRoute] = useState<MiniRoute>('home')
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [userInputText, setUserInputText] = useState('')
  const [clipboardText, setClipboardText] = useState('')
  const [isPinned, setIsPinnedState] = useState(false)

  // Wraps setState with an eager IPC call so main's pin flag is updated
  // synchronously inside the click handler — a useEffect-based sync would
  // defer IPC by at least one render, opening a race where blur fires with
  // the main flag still stale.
  const setIsPinned = useCallback((next: boolean) => {
    void window.api.quickAssistant.setPin(next)
    setIsPinnedState(next)
  }, [])

  const lastClipboardTextRef = useRef<string | null>(null)
  const inputBarRef = useRef<HTMLDivElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)

  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { defaultModel: defaultApiModel } = useDefaultModel()
  const { assistant: chosenAssistant, model: chosenApiModel } = useAssistant(quickAssistantId ?? '')
  const currentAssistant = chosenAssistant ?? defaultAssistant
  const currentModel = chosenApiModel ?? defaultApiModel

  // Lease a temporary topic for the quick-assistant conversation.
  // Lifecycle is tied to this component; resetting the conversation drops and leases a new one.
  // currentAssistant may be the synthesised default — only pass a real
  // persisted id (chosenAssistant) so main treats it as "no assistant" when
  // the user hasn't picked one.
  const {
    topicId: temporaryTopicId,
    ready: isTopicReady,
    reset: resetTemporaryTopic
  } = useTemporaryTopic({ enabled: true, assistantId: chosenAssistant?.id })

  const referenceText = clipboardText || userInputText

  const userContent = useMemo(() => {
    if (isFirstMessage) {
      return referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`.trim()
    }
    return userInputText.trim()
  }, [isFirstMessage, referenceText, userInputText])

  const [isPreparing, setIsPreparing] = useState(false)
  const [flowError, setFlowError] = useState<string | null>(null)

  const {
    messages: chatMessages,
    sendMessage,
    stop: stopChat,
    setMessages
  } = useChat<CherryUIMessage>({
    id: temporaryTopicId ?? 'pending-temp',
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (err) => {
      setIsPreparing(false)
      setFlowError(err.message)
    }
  })

  // Chunks are routed to the per-execution collector (Main tags every
  // chunk with its modelId). Primary `useChat.state.messages`
  // (chatMessages) only receives user messages pushed by `sendMessage` —
  // no assistant content. We accumulate assistant turns across completed
  // streams in `completedAssistants` so the multi-turn conversation
  // renders properly. Cleared on `clear()` together with `setMessages([])`.
  const { activeExecutions, isPending } = useTopicStreamStatus(temporaryTopicId ?? 'pending-temp')
  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose, resetExecutionMessages } =
    useExecutionMessages()
  const executionChats = useExecutionChats(temporaryTopicId ?? 'pending-temp', activeExecutions)
  const [completedAssistants, setCompletedAssistants] = useState<CherryUIMessage[]>([])

  const prevActiveCountRef = useRef(activeExecutions.length)
  useEffect(() => {
    const wasActive = prevActiveCountRef.current > 0
    prevActiveCountRef.current = activeExecutions.length
    if (activeExecutions.length === 0 && wasActive) {
      const finalized = collectLiveAssistants(executionMessagesById)
      if (finalized.length) {
        setCompletedAssistants((done) => [...done, ...finalized])
        resetExecutionMessages()
      }
    }
  }, [activeExecutions, executionMessagesById, resetExecutionMessages])

  useEffect(() => {
    if (isPending) setIsPreparing(false)
  }, [isPending])

  const liveAssistants = useMemo(() => collectLiveAssistants(executionMessagesById), [executionMessagesById])

  const allAssistants = useMemo<CherryUIMessage[]>(
    () => [...completedAssistants, ...liveAssistants],
    [completedAssistants, liveAssistants]
  )

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const m of chatMessages) map[m.id] = m.parts as CherryMessagePart[]
    for (const m of allAssistants) map[m.id] = m.parts as CherryMessagePart[]
    return map
  }, [chatMessages, allAssistants])

  // Interleave user messages (from state.messages) with assistant turns
  // (accumulated completed + live). The assumption: users and assistants
  // alternate strictly — user[i] precedes assistant[i]. Temporary topics
  // are always a clean linear chat, no branches.
  const adaptedMessages = useMemo(() => {
    const users = chatMessages.filter((m) => m.role === 'user')
    const latestAssistantId = liveAssistants[liveAssistants.length - 1]?.id
    const out: {
      id: string
      role: 'user' | 'assistant'
      assistantId: string
      topicId: string
      createdAt: string
      status: UserMessageStatus | AssistantMessageStatus
      blocks: never[]
    }[] = []
    const turns = Math.max(users.length, allAssistants.length)
    for (let i = 0; i < turns; i++) {
      const u = users[i]
      if (u) {
        out.push({
          id: u.id,
          role: 'user',
          assistantId: '',
          topicId: '',
          createdAt: '',
          status: UserMessageStatus.SUCCESS,
          blocks: []
        })
      }
      const a = allAssistants[i]
      if (a) {
        out.push({
          id: a.id,
          role: 'assistant',
          assistantId: '',
          topicId: '',
          createdAt: '',
          status:
            a.id === latestAssistantId && isPending
              ? AssistantMessageStatus.PROCESSING
              : AssistantMessageStatus.SUCCESS,
          blocks: []
        })
      }
    }
    return out
  }, [chatMessages, allAssistants, liveAssistants, isPending])

  const latestAssistantUIMsg = useMemo(() => allAssistants[allAssistants.length - 1], [allAssistants])

  const content = useMemo(
    () => (latestAssistantUIMsg ? getTextFromParts(latestAssistantUIMsg.parts as CherryMessagePart[]) : ''),
    [latestAssistantUIMsg]
  )

  const isStreaming = isPending

  const clear = useCallback(() => {
    void stopChat()
    setMessages([])
    setCompletedAssistants([])
    resetExecutionMessages()
    setFlowError(null)
    setIsPreparing(false)
  }, [stopChat, setMessages, resetExecutionMessages])

  const isLoading = isPreparing || isStreaming
  const isOutputted = adaptedMessages.some((message) => message.role === 'assistant')

  useEffect(() => {
    void i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  useEffect(() => {
    if (route === 'home') {
      setIsFirstMessage(true)
      setFlowError(null)
      clear()
    }
  }, [route, clear])

  const focusInput = useCallback(() => {
    if (!inputBarRef.current) return
    const input = inputBarRef.current.querySelector('input')
    input?.focus()
  }, [])

  const readClipboard = useCallback(async () => {
    if (!readClipboardAtStartup || !document.hasFocus()) return

    try {
      const text = await navigator.clipboard.readText()
      if (text && text !== lastClipboardTextRef.current) {
        lastClipboardTextRef.current = text
        setClipboardText(text.trim())
      }
    } catch (clipboardError) {
      logger.warn('Failed to read clipboard:', clipboardError as Error)
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
    window.electron.ipcRenderer.on(IpcChannel.QuickAssistant_Shown, onWindowShow)

    return () => {
      window.electron.ipcRenderer.removeAllListeners(IpcChannel.QuickAssistant_Shown)
    }
  }, [onWindowShow])

  useEffect(() => {
    void readClipboard()
  }, [readClipboard])

  const handleCloseWindow = useCallback(() => window.api.quickAssistant.hide(), [])

  const handleSendMessage = useCallback(
    async (prompt?: string) => {
      if (isEmpty(userContent)) return
      if (!isTopicReady || !temporaryTopicId) return

      try {
        setFlowError(null)
        setIsFirstMessage(false)
        setUserInputText('')
        setIsPreparing(true)
        // topicId comes from useChat id; Main resolves assistant/model from topic.assistantId.
        void sendMessage({ text: [prompt, userContent].filter(Boolean).join('\n\n') })
      } catch (streamError) {
        const resolvedError = streamError instanceof Error ? streamError : new Error('An error occurred')
        setFlowError(resolvedError.message)
        logger.error('Error fetching result:', resolvedError)
      }
    },
    [sendMessage, temporaryTopicId, isTopicReady, userContent]
  )

  const handlePause = useCallback(() => {
    void stopChat()
  }, [stopChat])

  const resetConversation = useCallback(() => {
    // Drop the current temporary topic and let useTemporaryTopic lease a fresh one.
    resetTemporaryTopic()
    clear()
  }, [clear, resetTemporaryTopic])

  const handleEsc = useCallback(() => {
    if (isLoading) {
      handlePause()
      return
    }

    if (route === 'home') {
      void handleCloseWindow()
      return
    }

    resetConversation()
    featureMenusRef.current?.resetSelectedIndex()
    setFlowError(null)
    setRoute('home')
    setUserInputText('')
  }, [handleCloseWindow, handlePause, isLoading, resetConversation, route])

  const handleCopy = useCallback(() => {
    if (!content) return
    void navigator.clipboard.writeText(content)
    window.toast.success(t('message.copy.success'))
  }, [content, t])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return
    }

    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        if (isLoading) return
        e.preventDefault()
        if (userContent) {
          if (route === 'home') {
            featureMenusRef.current?.useFeature()
          } else {
            setRoute('chat')
            void handleSendMessage()
            focusInput()
          }
        }
        break
      case 'Backspace':
        if (userInputText.length === 0) {
          void clearClipboard()
        }
        break
      case 'ArrowUp':
        if (route === 'home') {
          e.preventDefault()
          featureMenusRef.current?.prevFeature()
        }
        break
      case 'ArrowDown':
        if (route === 'home') {
          e.preventDefault()
          featureMenusRef.current?.nextFeature()
        }
        break
      case 'Escape':
        handleEsc()
        break
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserInputText(e.target.value)
  }

  const backgroundColor = useMemo(() => {
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }
    return 'var(--color-background)'
  }, [windowStyle, theme])

  const inputPlaceholder = useMemo(() => {
    if (referenceText && route === 'home') {
      return t('quickAssistant.input.placeholder.title')
    }
    return t('quickAssistant.input.placeholder.empty', {
      model: quickAssistantId ? (currentAssistant?.name ?? '') : (currentModel?.name ?? '')
    })
  }, [referenceText, route, t, quickAssistantId, currentAssistant, currentModel])

  const baseFooterProps = useMemo(
    () => ({
      route,
      loading: isLoading,
      onEsc: handleEsc,
      setIsPinned,
      isPinned
    }),
    [route, isLoading, handleEsc, setIsPinned, isPinned]
  )

  switch (route) {
    case 'chat':
    case 'summary':
    case 'explanation':
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          {route === 'chat' && currentAssistant && (
            <>
              <InputBar
                text={userInputText}
                assistant={currentAssistant}
                model={currentModel}
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
          {temporaryTopicId &&
            activeExecutions.map(({ executionId }) => {
              const execChat = executionChats.get(executionId)
              if (!execChat) return null
              return (
                <ExecutionStreamCollector
                  key={executionId}
                  executionId={executionId}
                  chat={execChat}
                  onMessagesChange={handleExecutionMessagesChange}
                  onDispose={handleExecutionDispose}
                />
              )
            })}
          <ChatWindow
            route={route}
            assistant={currentAssistant ?? null}
            isOutputted={isOutputted}
            messages={adaptedMessages}
            partsMap={partsMap}
          />
          {flowError && <ErrorMsg>{flowError}</ErrorMsg>}

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

    default:
      return (
        <Container style={{ backgroundColor }} $draggable={draggable}>
          {currentAssistant && (
            <InputBar
              text={userInputText}
              assistant={currentAssistant}
              model={currentModel}
              referenceText={referenceText}
              placeholder={inputPlaceholder}
              loading={isLoading}
              handleKeyDown={handleKeyDown}
              handleChange={handleChange}
              ref={inputBarRef}
            />
          )}
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
