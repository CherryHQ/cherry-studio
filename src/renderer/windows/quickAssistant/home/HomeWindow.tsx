import { useChat } from '@ai-sdk/react'
import { Separator } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { toMessageListItem } from '@renderer/components/chat/messages'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import i18n from '@renderer/i18n'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { cn } from '@renderer/utils/style'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { type CherryReasoningMeta, readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import { IpcChannel } from '@shared/IpcChannel'
import { defaultLanguage } from '@shared/utils/languages'
import { isEmpty } from 'lodash'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChatWindow from '../chat/ChatWindow'
import TranslateWindow from '../translate/TranslateWindow'
import ClipboardPreview from './components/ClipboardPreview'
import type { FeatureMenusRef } from './components/FeatureMenus'
import FeatureMenus from './components/FeatureMenus'
import Footer from './components/Footer'
import InputBar from './components/InputBar'

const logger = loggerService.withContext('HomeWindow')

// Stable empty array — quick-assistant temp topic has no DB-backed messages.
const EMPTY_UI_MESSAGES: CherryUIMessage[] = []

type MiniRoute = 'home' | 'chat' | 'translate' | 'summary' | 'explanation'

/**
 * Finalize a list of live assistant messages: turn any still-streaming
 * reasoning part into `state: 'done'`, deriving `thinkingMs` from
 * `startedAt` if the upstream hasn't set it yet. Called when the execution
 * transitions from active to inactive.
 */
const finalizeLiveMessages = (messages: CherryUIMessage[]): CherryUIMessage[] => {
  return messages.map((msg) => {
    if (!msg.parts) return msg
    let changed = false
    const newParts = msg.parts.map((part) => {
      if (part.type !== 'reasoning' || part.state !== 'streaming') return part
      const cherry = readCherryMeta(part)
      const startedAt = cherry?.startedAt
      const thinkingMs = cherry?.thinkingMs

      let patch: Partial<CherryReasoningMeta> = {}
      if (typeof startedAt === 'number' && Number.isFinite(startedAt) && typeof thinkingMs !== 'number') {
        patch = { thinkingMs: Math.round(Math.max(0, Date.now() - startedAt)) }
      }

      changed = true
      return withCherryMeta({ ...part, state: 'done' }, patch)
    })
    return changed ? { ...msg, parts: newParts } : msg
  })
}

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

  const { defaultModel: defaultApiModel } = useDefaultModel()
  const { assistant: chosenAssistant, model: chosenApiModel } = useAssistant(quickAssistantId ?? '')
  const currentAssistant = chosenAssistant
  const currentModel = chosenApiModel ?? defaultApiModel

  // Lease a temporary topic for the quick-assistant conversation.
  // Lifecycle is tied to this component; resetting the conversation drops and leases a new one.
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
  const { liveAssistants, reset: resetExecutionMessages } = useExecutionOverlay(
    temporaryTopicId ?? 'pending-temp',
    activeExecutions,
    EMPTY_UI_MESSAGES
  )
  const [completedAssistants, setCompletedAssistants] = useState<CherryUIMessage[]>([])

  const prevActiveCountRef = useRef(activeExecutions.length)
  useEffect(() => {
    const wasActive = prevActiveCountRef.current > 0
    prevActiveCountRef.current = activeExecutions.length
    if (activeExecutions.length === 0 && wasActive) {
      // Snapshots are retained after a reader tears down, so the final
      // frames are still in `liveAssistants` at this →0 transition.
      if (liveAssistants.length) {
        setCompletedAssistants((done) => [...done, ...finalizeLiveMessages(liveAssistants)])
        resetExecutionMessages()
      }
    }
  }, [activeExecutions, liveAssistants, resetExecutionMessages])

  useEffect(() => {
    if (isPending) setIsPreparing(false)
  }, [isPending])

  const allAssistants = useMemo<CherryUIMessage[]>(
    () => [...completedAssistants, ...liveAssistants],
    [completedAssistants, liveAssistants]
  )

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of [...chatMessages, ...allAssistants]) {
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }
    return next
  }, [allAssistants, chatMessages])

  // Interleave user messages (from state.messages) with assistant turns
  // (accumulated completed + live). The assumption: users and assistants
  // alternate strictly — user[i] precedes assistant[i]. Temporary topics
  // are always a clean linear chat, no branches.
  const displayMessages = useMemo<CherryUIMessage[]>(() => {
    const users = chatMessages.filter((m) => m.role === 'user')
    const latestAssistantId = liveAssistants[liveAssistants.length - 1]?.id
    const out: CherryUIMessage[] = []
    const turns = Math.max(users.length, allAssistants.length)
    for (let i = 0; i < turns; i++) {
      const u = users[i]
      if (u) {
        out.push(u)
      }
      const a = allAssistants[i]
      if (a) {
        out.push({
          ...a,
          metadata: {
            ...a.metadata,
            status: a.id === latestAssistantId && isPending ? 'pending' : 'success'
          }
        })
      }
    }
    return out
  }, [chatMessages, allAssistants, liveAssistants, isPending])

  const quickAssistantModelSnapshot = useMemo<ModelSnapshot | undefined>(
    () =>
      currentModel
        ? {
            id: currentModel.id,
            name: currentModel.name,
            provider: currentModel.providerId,
            ...(currentModel.group && { group: currentModel.group })
          }
        : undefined,
    [currentModel]
  )

  const messageItems = useMemo(
    () =>
      displayMessages.map((message) =>
        toMessageListItem(message, {
          assistantId: currentAssistant?.id,
          topicId: temporaryTopicId ?? '',
          modelFallback: quickAssistantModelSnapshot
        })
      ),
    [currentAssistant?.id, displayMessages, quickAssistantModelSnapshot, temporaryTopicId]
  )

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
  const isOutputted = messageItems.some((message) => message.role === 'assistant')

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
        <div className={containerClassName(draggable)} style={{ backgroundColor }}>
          {route === 'chat' && (currentAssistant || currentModel) && (
            <>
              <InputBar
                text={userInputText}
                model={currentModel}
                referenceText={referenceText}
                placeholder={inputPlaceholder}
                loading={isLoading}
                handleKeyDown={handleKeyDown}
                handleChange={handleChange}
                ref={inputBarRef}
              />
              <Separator className="my-2.5" />
            </>
          )}
          {['summary', 'explanation'].includes(route) && (
            <div className="mt-2.5">
              <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
            </div>
          )}
          <ChatWindow
            route={route}
            assistant={currentAssistant ?? null}
            isOutputted={isOutputted}
            messages={messageItems}
            partsByMessageId={partsByMessageId}
          />
          {flowError && (
            <div className="mb-3 break-all rounded border border-error-border bg-error-bg px-3 py-2 text-[13px] text-error-text">
              {flowError}
            </div>
          )}

          <Separator className="my-2.5" />
          <Footer key="footer" {...baseFooterProps} onCopy={handleCopy} />
        </div>
      )

    case 'translate':
      return (
        <div className={containerClassName(draggable)} style={{ backgroundColor }}>
          <TranslateWindow text={referenceText} />
          <Separator className="my-2.5" />
          <Footer key="footer" {...baseFooterProps} />
        </div>
      )

    default:
      return (
        <div className={containerClassName(draggable)} style={{ backgroundColor }}>
          {(currentAssistant || currentModel) && (
            <InputBar
              text={userInputText}
              model={currentModel}
              referenceText={referenceText}
              placeholder={inputPlaceholder}
              loading={isLoading}
              handleKeyDown={handleKeyDown}
              handleChange={handleChange}
              ref={inputBarRef}
            />
          )}
          <Separator className="my-2.5" />
          <ClipboardPreview referenceText={referenceText} clearClipboard={clearClipboard} t={t} />
          <main className="flex flex-1 flex-col overflow-hidden">
            <FeatureMenus
              setRoute={setRoute}
              onSendMessage={handleSendMessage}
              text={userContent}
              ref={featureMenusRef}
            />
          </main>
          <Separator className="my-2.5" />
          <Footer
            key="footer"
            {...baseFooterProps}
            canUseBackspace={userInputText.length > 0 || clipboardText.length === 0}
            clearClipboard={clearClipboard}
          />
        </div>
      )
  }
}

const containerClassName = (draggable: boolean) =>
  cn(
    'flex h-full w-full flex-1 flex-col px-2.5 py-2',
    draggable ? '[-webkit-app-region:drag]' : '[-webkit-app-region:no-drag]'
  )

export default HomeWindow
