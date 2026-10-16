import { useChat } from '@ai-sdk/react'
import { isEmpty } from 'es-toolkit/compat'
import { ArrowUp, Square } from 'lucide-react'
import type { FC } from 'react'
import React, { Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Separator } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { ModelSpeedControl, resolveSupportedReasoningEffort } from '@renderer/components/ModelSpeedControl'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTheme } from '@renderer/hooks/useTheme'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { ipcChatTransport } from '@renderer/services/aiTransport'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { autoReadService, readMessageAloud, voiceTargetManager } from '@renderer/services/voice'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { isEmbeddingModel, isRerankModel } from '@renderer/utils/model'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { type CherryReasoningMeta, readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import type { QuickChatRequest } from '@shared/ipc/schemas/quickAssistant'

import ClipboardPreview from './components/ClipboardPreview'
import type { FeatureMenusRef } from './components/FeatureMenus'
import FeatureMenus from './components/FeatureMenus'
import Footer from './components/Footer'
import InputBar from './components/InputBar'
import QuickChatToolbar from './components/QuickChatToolbar'

// Lazy boundaries (S6b): the chat/translate branches carry the heavy message
// rendering chain (ChatMarkdown, CodeMirror, katex, mermaid). The default
// 'home' route never renders them, so they stay out of the first paint and
// only load when a feature is actually invoked.
const ChatWindow = React.lazy(() => import('../chat/ChatWindow'))
const TranslateWindow = React.lazy(() => import('../translate/TranslateWindow'))

// Size-stable fallback: the shell (input bar / footer) renders synchronously
// around it, so the brief local-chunk load must not collapse the layout.
const LazyBranchFallback = () => <div className="flex-1" />

const logger = loggerService.withContext('HomeWindow')

// Stable empty array — quick-assistant temp topic has no DB-backed messages.
const EMPTY_UI_MESSAGES: CherryUIMessage[] = []

type MiniRoute = 'home' | 'chat' | 'translate' | 'summary' | 'explanation'

const supportsVoicePlayback = (route: MiniRoute) => route === 'chat' || route === 'summary' || route === 'explanation'

/**
 * Finalize a list of live assistant messages: turn any still-streaming text
 * or reasoning part into `state: 'done'`, deriving `thinkingMs` for reasoning
 * from `startedAt` if the upstream hasn't set it yet. Called when the
 * execution transitions from active to inactive.
 */
export const finalizeLiveMessages = (messages: CherryUIMessage[]): CherryUIMessage[] => {
  return messages.map((msg) => {
    if (!msg.parts) return msg
    let changed = false
    const newParts = msg.parts.map((part) => {
      if ((part.type !== 'text' && part.type !== 'reasoning') || part.state !== 'streaming') return part

      changed = true
      if (part.type === 'text') return { ...part, state: 'done' as const }

      const cherry = readCherryMeta(part)
      const startedAt = cherry?.startedAt
      const thinkingMs = cherry?.thinkingMs

      let patch: Partial<CherryReasoningMeta> = {}
      if (typeof startedAt === 'number' && Number.isFinite(startedAt) && typeof thinkingMs !== 'number') {
        patch = { thinkingMs: Math.round(Math.max(0, Date.now() - startedAt)) }
      }

      return withCherryMeta({ ...part, state: 'done' }, patch)
    })
    return changed ? { ...msg, parts: newParts } : msg
  })
}

const HomeWindow: FC<{ draggable?: boolean }> = ({ draggable = true }) => {
  const [defaultTemporary] = usePreference('feature.quick_assistant.default_temporary')
  const [readClipboardAtStartup] = usePreference('feature.quick_assistant.read_clipboard_at_startup')
  const [quickAssistantId] = usePreference('feature.quick_assistant.assistant_id')
  const [autoReadEnabled] = usePreference('feature.voice.auto_read.enabled')
  const [windowStyle] = usePreference('ui.window_style')
  const { theme } = useTheme()
  const { t } = useTranslation()

  const [route, setRoute] = useState<MiniRoute>('home')
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [userInputText, setUserInputText] = useState('')
  const [clipboardText, setClipboardText] = useState('')
  const [selectedModel, setSelectedModel] = useState<Model | undefined>()
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>('default')
  const [savedTopicId, setSavedTopicId] = useState<string | null>(null)
  const [saveOnSend, setSaveOnSend] = useState(!defaultTemporary)
  const [pendingLaunch, setPendingLaunch] = useState<(QuickChatRequest & { previousTopicId: string | null }) | null>(
    null
  )
  const launchRequest = useWindowInitData<QuickChatRequest>()
  const lastLaunchRequestId = useRef<string | null>(null)

  const lastClipboardTextRef = useRef<string | null>(null)
  // Bumped by Stop; a send still preparing (saving the topic) bails out when it changes.
  const sendGenerationRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const featureMenusRef = useRef<FeatureMenusRef>(null)

  const { quickModel: quickApiModel, isQuickModelPending } = useDefaultModel()
  const { assistant: chosenAssistant, model: chosenApiModel, isModelPending } = useAssistant(quickAssistantId ?? '')
  const isAssistantMode = Boolean(quickAssistantId)
  const currentAssistant = chosenAssistant
  const currentModel = selectedModel ?? (isAssistantMode ? chosenApiModel : quickApiModel)
  const effectiveReasoningEffort = currentModel
    ? resolveSupportedReasoningEffort(currentModel, reasoningEffort)
    : 'default'

  // Lease a temporary topic for the quick-assistant conversation.
  // Lifecycle is tied to this component; resetting the conversation drops and leases a new one.
  const {
    topicId: temporaryTopicId,
    ready: isTopicReady,
    reset: resetTemporaryTopic,
    persist: persistTemporaryTopic
  } = useTemporaryTopic({ enabled: true, assistantId: chosenAssistant?.id })

  const isStoredChat = savedTopicId !== null && savedTopicId === temporaryTopicId
  const { data: storedTopic } = useQuery('/topics/:id', {
    params: { id: savedTopicId ?? '' },
    enabled: isStoredChat
  })
  const isSavedChat = isStoredChat && (saveOnSend || (storedTopic?.id === savedTopicId && !storedTopic.expiresAt))

  const requestText = useMemo(() => {
    const trimmedUserInput = userInputText.trim()
    if (!isFirstMessage || !clipboardText) return trimmedUserInput
    if (!trimmedUserInput || clipboardText === trimmedUserInput) return clipboardText
    return `${clipboardText}\n\n${trimmedUserInput}`
  }, [clipboardText, isFirstMessage, userInputText])

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
  const [lastCompletedVoiceMessage, setLastCompletedVoiceMessage] = useState<CherryUIMessage | null>(null)
  const voiceScopeGenerationRef = useRef(0)
  const voiceScopeTopicRef = useRef(temporaryTopicId)
  // Executions that belonged to a conversation dropped by resetConversation(). The stream status
  // can still list them for a render after the topic changes, so they must never be re-adopted.
  const retiredExecutionKeysRef = useRef(new Set<string>())
  const voiceExecutionContextsRef = useRef(
    new Map<string, { topicId: string; generation: number; eligible: boolean }>()
  )

  useEffect(() => {
    if (voiceScopeTopicRef.current === temporaryTopicId) return
    voiceScopeTopicRef.current = temporaryTopicId
    voiceScopeGenerationRef.current += 1
    voiceExecutionContextsRef.current.clear()
    setLastCompletedVoiceMessage(null)
  }, [temporaryTopicId])

  useEffect(() => {
    if (!temporaryTopicId || voiceScopeTopicRef.current !== temporaryTopicId) return
    for (const execution of activeExecutions) {
      const key = `${execution.executionId}:${execution.attemptId}`
      if (voiceExecutionContextsRef.current.has(key) || retiredExecutionKeysRef.current.has(key)) continue
      voiceExecutionContextsRef.current.set(key, {
        topicId: temporaryTopicId,
        generation: voiceScopeGenerationRef.current,
        eligible: supportsVoicePlayback(route)
      })
    }
  }, [activeExecutions, route, temporaryTopicId])

  const handleExecutionFinish = useCallback(
    (executionId: string, { attemptId, message, isAbort, isError }: ExecutionFinishEvent) => {
      const key = `${executionId}:${attemptId}`
      const context = voiceExecutionContextsRef.current.get(key)
      if (!context) return
      voiceExecutionContextsRef.current.delete(key)
      if (context.topicId !== temporaryTopicId || context.generation !== voiceScopeGenerationRef.current) {
        return
      }

      void autoReadService.consume({
        enabled: autoReadEnabled,
        message,
        attemptId,
        isAbort,
        isError,
        eligible: context.eligible
      })

      if (
        context.eligible &&
        message.role === 'assistant' &&
        !isAbort &&
        !isError &&
        getTextFromParts(message.parts ?? []).trim()
      ) {
        setLastCompletedVoiceMessage(message)
      }
    },
    [autoReadEnabled, temporaryTopicId]
  )
  const {
    liveAssistants,
    reset: resetExecutionMessages,
    clear: clearExecutionMessages
  } = useExecutionOverlay(temporaryTopicId ?? 'pending-temp', activeExecutions, EMPTY_UI_MESSAGES, {
    onFinish: handleExecutionFinish
  })
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
      next[message.id] = message.parts ?? []
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

  const messageItems = useMemo(
    () =>
      displayMessages.map((message) =>
        toMessageListItem(message, {
          assistantId: currentAssistant?.id,
          topicId: temporaryTopicId ?? ''
        })
      ),
    [currentAssistant?.id, displayMessages, temporaryTopicId]
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
    clearExecutionMessages()
    setFlowError(null)
    setIsPreparing(false)
  }, [stopChat, setMessages, clearExecutionMessages])

  const isLoading = isPreparing || isStreaming
  const isOutputted = messageItems.some((message) => message.role === 'assistant')
  const dictationTargetId =
    temporaryTopicId && (route === 'home' || route === 'chat') ? `quick-assistant-input:${temporaryTopicId}` : undefined

  useEffect(() => {
    if (!temporaryTopicId || !dictationTargetId) return

    return voiceTargetManager.bind({
      targetId: dictationTargetId,
      owner: window,
      sourceEntityId: temporaryTopicId,
      captureReplaceRange: () => {
        const input = inputRef.current
        if (!input || input.selectionStart === null || input.selectionEnd === null) return null
        return { from: input.selectionStart, to: input.selectionEnd }
      },
      replaceRange: ({ from, to }, text) => {
        const input = inputRef.current
        if (!input || from < 0 || to < from || to > input.value.length) return false
        const next = `${input.value.slice(0, from)}${text}${input.value.slice(to)}`
        const caret = from + text.length
        setUserInputText(next)
        queueMicrotask(() => inputRef.current?.setSelectionRange(caret, caret))
        return true
      }
    })
  }, [dictationTargetId, temporaryTopicId])

  useEffect(() => {
    if (route === 'home') {
      setSaveOnSend(!defaultTemporary)
      setIsFirstMessage(true)
      setFlowError(null)
      clear()
    }
  }, [route, clear, defaultTemporary])

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
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

  useIpcOn('quick_assistant.shown', onWindowShow)

  useEffect(() => {
    void readClipboard()
  }, [readClipboard])

  const handleCloseWindow = useCallback(() => ipcApi.request('quick_assistant.hide'), [])

  const handleSendMessage = useCallback(
    async (prompt?: string, launcherText?: string) => {
      const text = launcherText ?? requestText
      if (isEmpty(text)) return
      if (!isTopicReady || !temporaryTopicId) return
      if (!currentModel) return

      const generation = ++sendGenerationRef.current
      const isCancelled = () => sendGenerationRef.current !== generation
      try {
        setFlowError(null)
        setIsPreparing(true)
        if (saveOnSend && !isStoredChat) {
          await persistTemporaryTopic(text)
          setSavedTopicId(temporaryTopicId)
          if (isCancelled()) return
        }
        const parentAnchorId =
          isStoredChat || saveOnSend
            ? (await dataApiService.get(`/topics/${temporaryTopicId}`)).activeNodeId
            : undefined
        if (isCancelled()) return
        setIsFirstMessage(false)
        setUserInputText('')
        setIsPreparing(true)
        const message = { text: [prompt, text].filter(Boolean).join('\n\n') }
        void sendMessage(message, {
          body: {
            ...(parentAnchorId ? { parentAnchorId } : {}),
            ...((selectedModel || !isAssistantMode) && currentModel ? { mentionedModels: [currentModel.id] } : {}),
            reasoningEffort: effectiveReasoningEffort
          }
        })
      } catch (streamError) {
        setIsPreparing(false)
        const resolvedError = streamError instanceof Error ? streamError : new Error('An error occurred')
        setFlowError(resolvedError.message)
        logger.error('Error fetching result:', resolvedError)
      }
    },
    [
      currentModel,
      effectiveReasoningEffort,
      selectedModel,
      isAssistantMode,
      isStoredChat,
      isTopicReady,
      persistTemporaryTopic,
      requestText,
      saveOnSend,
      sendMessage,
      temporaryTopicId
    ]
  )

  const handlePause = useCallback(() => {
    sendGenerationRef.current++
    setIsPreparing(false)
    void stopChat()
  }, [stopChat])

  const resetConversation = useCallback(() => {
    // Drop the current temporary topic and let useTemporaryTopic lease a fresh one.
    // Invalidate any send still preparing for the old conversation (topic lookup, persist).
    sendGenerationRef.current++
    setIsPreparing(false)
    voiceScopeGenerationRef.current += 1
    for (const key of voiceExecutionContextsRef.current.keys()) retiredExecutionKeysRef.current.add(key)
    for (const execution of activeExecutions) {
      retiredExecutionKeysRef.current.add(`${execution.executionId}:${execution.attemptId}`)
    }
    voiceScopeTopicRef.current = null
    voiceExecutionContextsRef.current.clear()
    setLastCompletedVoiceMessage(null)
    resetTemporaryTopic()
    clear()
    setSavedTopicId(null)
    setSaveOnSend(!defaultTemporary)
  }, [activeExecutions, clear, resetTemporaryTopic, defaultTemporary])

  useIpcOn('quick_assistant.chat.expired', ({ topicIds }) => {
    if (!temporaryTopicId || !topicIds.includes(temporaryTopicId)) return
    resetConversation()
    setRoute('home')
    setUserInputText('')
    void handleCloseWindow()
  })

  const receiveLauncherChat = useEffectEvent(async (request: QuickChatRequest) => {
    if (!isStoredChat && chatMessages.some((message) => message.role === 'user')) {
      const confirmed = await popup.confirm({
        title: t('quickAssistant.chat.temporary'),
        content: t('quickAssistant.chat.discard_confirm')
      })
      if (!confirmed) {
        await ipcApi.request('quick_assistant.chat.ack', { requestId: request.requestId })
        return
      }
    }
    await stopChat()
    if (lastLaunchRequestId.current !== request.requestId) return
    resetConversation()
    setClipboardText('')
    lastClipboardTextRef.current = null
    setIsFirstMessage(false)
    setUserInputText(request.prompt)
    setSaveOnSend(!request.temporary)
    setRoute('chat')
    setPendingLaunch({ ...request, previousTopicId: temporaryTopicId })
    await ipcApi.request('quick_assistant.chat.ack', { requestId: request.requestId })
  })

  useEffect(() => {
    if (launchRequest?.kind !== 'chat' || lastLaunchRequestId.current === launchRequest.requestId) return
    lastLaunchRequestId.current = launchRequest.requestId
    void receiveLauncherChat(launchRequest).catch((error) => {
      setFlowError(error instanceof Error ? error.message : String(error))
    })
    // Effect Events read the current conversation without reprocessing a launch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest])

  const submitLauncherChat = useEffectEvent((request: QuickChatRequest) => {
    if (lastLaunchRequestId.current !== request.requestId) return
    if (request.submit && request.prompt.trim()) void handleSendMessage(undefined, request.prompt)
    focusInput()
  })

  useEffect(() => {
    if (!pendingLaunch || !isTopicReady || temporaryTopicId === pendingLaunch.previousTopicId) return
    if (!currentModel && (isAssistantMode ? isModelPending : isQuickModelPending)) return
    setPendingLaunch(null)
    if (currentModel) submitLauncherChat(pendingLaunch)
    else focusInput()
    // submitLauncherChat is an Effect Event, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingLaunch,
    isTopicReady,
    temporaryTopicId,
    currentModel,
    isAssistantMode,
    isModelPending,
    isQuickModelPending,
    focusInput
  ])

  const saveConversation = async () => {
    if (!temporaryTopicId) return
    if (!isStoredChat) {
      const firstUserMessage = chatMessages.find((message) => message.role === 'user')
      await persistTemporaryTopic(
        firstUserMessage ? getTextFromParts(firstUserMessage.parts) : userInputText || undefined,
        !saveOnSend
      )
      setSavedTopicId(temporaryTopicId)
    }
  }

  const openInMainWindow = async () => {
    if (!temporaryTopicId || isLoading) return
    try {
      await saveConversation()
      await ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${temporaryTopicId}` })
      await handleCloseWindow()
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : String(error))
    }
  }

  const minimizeConversation = async () => {
    if (!isStoredChat && isLoading) return
    try {
      if (route !== 'home' && route !== 'translate') await saveConversation()
      await handleCloseWindow()
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : String(error))
    }
  }

  const deleteConversation = async () => {
    if (!temporaryTopicId || isLoading) return
    const confirmed = await popup.confirm({ title: t('common.delete'), content: t('common.delete_confirm') })
    if (!confirmed) return
    try {
      if (isStoredChat) await ipcApi.request('trash.topic.delete_permanently', { topicIds: [temporaryTopicId] })
      resetConversation()
      setRoute('home')
      setUserInputText('')
      await handleCloseWindow()
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleEsc = useCallback(() => {
    void handleCloseWindow()
  }, [handleCloseWindow])

  const handleCopy = useCallback(() => {
    if (!content) return
    void navigator.clipboard.writeText(content).then(
      () => toast.success(t('message.copy.success')),
      (error) => setFlowError(error instanceof Error ? error.message : String(error))
    )
  }, [content, t])

  const handleReadAloud = useCallback(() => {
    if (isLoading || !lastCompletedVoiceMessage?.parts) return
    void readMessageAloud({
      messageId: lastCompletedVoiceMessage.id,
      parts: lastCompletedVoiceMessage.parts,
      focusOnClose: focusInput
    })
  }, [focusInput, isLoading, lastCompletedVoiceMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return
    }

    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        if (isLoading) return
        e.preventDefault()
        if (requestText) {
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
        e.preventDefault()
        e.stopPropagation()
        handleEsc()
        break
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserInputText(e.target.value)
  }

  const backgroundColor = useMemo(() => {
    if (!isMac) {
      return 'var(--popover)'
    }
    if (isMac && windowStyle === 'transparent' && theme === ThemeMode.light) {
      return 'transparent'
    }
    return 'var(--background)'
  }, [windowStyle, theme])

  const inputPlaceholder = useMemo(() => {
    if (clipboardText && route === 'home') {
      return t('quickAssistant.input.placeholder.title')
    }
    return t('quickAssistant.input.placeholder.empty', {
      model: quickAssistantId ? (currentAssistant?.name ?? '') : (currentModel?.name ?? '')
    })
  }, [clipboardText, route, t, quickAssistantId, currentAssistant, currentModel])

  const baseFooterProps = useMemo(
    () => ({
      route,
      loading: isLoading,
      onEsc: handleEsc
    }),
    [route, isLoading, handleEsc]
  )

  switch (route) {
    case 'chat':
    case 'summary':
    case 'explanation':
      return (
        <div data-ui="quick-assistant.view" className={containerClassName(false)} style={{ backgroundColor }}>
          <QuickChatToolbar
            saved={isSavedChat || saveOnSend}
            loading={isLoading || !isTopicReady || pendingLaunch !== null}
            onNewTemporaryChat={() =>
              void ipcApi.request('quick_assistant.chat.open', { prompt: '', temporary: true, submit: false })
            }
            onOpenInMainWindow={() => void openInMainWindow()}
            onClose={() => void (isSavedChat || saveOnSend ? minimizeConversation() : deleteConversation())}
            minimizeDisabled={(!isStoredChat && isLoading) || !isTopicReady || pendingLaunch !== null}
            onMinimize={() => void minimizeConversation()}
          />
          {route === 'chat' && (
            <div className="my-3 flex items-center gap-2 [-webkit-app-region:no-drag]">
              <ModelSelector
                multiple={false}
                filter={(model) =>
                  !isEmbeddingModel(model) &&
                  !isRerankModel(model) &&
                  (!model.outputModalities || model.outputModalities.includes('text'))
                }
                value={currentModel}
                side="bottom"
                onSelect={(model) => {
                  if (!model) return
                  setSelectedModel(model)
                  setReasoningEffort(resolveSupportedReasoningEffort(model, reasoningEffort))
                }}
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isLoading}
                    aria-label={t('button.select_model')}
                    className="min-w-0 max-w-full">
                    <span className="truncate">{currentModel?.name ?? t('button.select_model')}</span>
                  </Button>
                }
              />
              {currentModel && !isLoading && (
                <ModelSpeedControl
                  model={currentModel}
                  reasoningEffort={effectiveReasoningEffort}
                  side="bottom"
                  onReasoningEffortChange={setReasoningEffort}
                />
              )}
            </div>
          )}
          {['summary', 'explanation'].includes(route) && (
            <div className="mt-2.5">
              <ClipboardPreview clipboardText={clipboardText} clearClipboard={clearClipboard} t={t} />
            </div>
          )}
          <Suspense fallback={<LazyBranchFallback />}>
            <ChatWindow
              route={route}
              assistant={currentAssistant ?? null}
              isOutputted={isOutputted}
              messages={messageItems}
              partsByMessageId={partsByMessageId}
            />
          </Suspense>
          {flowError && (
            <div className="mb-3 rounded border border-error-border bg-error-subtle px-3 py-2 text-[13px] break-all text-error-subtle-foreground">
              {flowError}
            </div>
          )}

          {route === 'chat' && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-input bg-background p-3 [-webkit-app-region:no-drag]">
              <InputBar
                text={userInputText}
                model={currentModel}
                placeholder={inputPlaceholder}
                loading={isLoading}
                handleKeyDown={handleKeyDown}
                inputRef={inputRef}
                dictationTargetId={dictationTargetId}
                handleChange={handleChange}
              />
              <Button
                size="icon-sm"
                aria-label={t(isLoading ? 'common.stop' : 'chat.input.send')}
                disabled={!isLoading && (!requestText || !currentModel || !isTopicReady)}
                onClick={() => (isLoading ? handlePause() : void handleSendMessage())}>
                {isLoading ? <Square className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
          )}
          {route !== 'chat' && isLoading && (
            <Button className="mt-3 self-end [-webkit-app-region:no-drag]" onClick={handlePause}>
              <Square className="size-4" />
              {t('common.stop')}
            </Button>
          )}
          <Footer
            key="footer"
            {...baseFooterProps}
            onCopy={handleCopy}
            onReadAloud={lastCompletedVoiceMessage ? handleReadAloud : undefined}
          />
        </div>
      )

    case 'translate':
      return (
        <div data-ui="quick-assistant.view" className={containerClassName(draggable)} style={{ backgroundColor }}>
          <Suspense fallback={<LazyBranchFallback />}>
            <TranslateWindow text={requestText} />
          </Suspense>
          <Separator className="my-2.5" />
          <Footer key="footer" {...baseFooterProps} />
        </div>
      )

    default:
      return (
        <div data-ui="quick-assistant.view" className={containerClassName(draggable)} style={{ backgroundColor }}>
          {(currentAssistant || currentModel) && (
            <InputBar
              text={userInputText}
              model={currentModel}
              placeholder={inputPlaceholder}
              loading={isLoading}
              inputRef={inputRef}
              dictationTargetId={dictationTargetId}
              handleKeyDown={handleKeyDown}
              handleChange={handleChange}
            />
          )}
          <Separator className="my-2.5" />
          <ClipboardPreview clipboardText={clipboardText} clearClipboard={clearClipboard} t={t} />
          <main className="flex flex-1 flex-col overflow-hidden">
            <FeatureMenus
              setRoute={setRoute}
              onSendMessage={handleSendMessage}
              text={requestText}
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
    'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl px-4 py-3',
    draggable ? '[-webkit-app-region:drag]' : '[-webkit-app-region:no-drag]'
  )

export default HomeWindow
