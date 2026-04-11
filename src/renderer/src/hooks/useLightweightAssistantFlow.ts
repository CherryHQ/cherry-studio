import { type CherryUIMessage, useAiChat } from '@renderer/hooks/useAiChat'
import type { Assistant } from '@renderer/types'
import { AssistantMessageStatus, type Message, UserMessageStatus } from '@renderer/types/newMessage'
import { buildAssistantRuntimeOverrides } from '@renderer/utils/assistantRuntimeOverrides'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ChatStatus } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type CompletionState = 'idle' | 'running' | 'success' | 'paused' | 'error'

interface RunOptions {
  assistant: Assistant
  prompt: string
  extraBody?: Record<string, unknown>
  reset?: boolean
}

interface UseLightweightAssistantFlowOptions {
  chatId: string
  topicId: string
  assistantId?: string
  onStreamStart?: () => void
}

interface UseLightweightAssistantFlowResult {
  messages: CherryUIMessage[]
  adaptedMessages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
  status: ChatStatus
  error: string | null
  isPreparing: boolean
  isStreaming: boolean
  content: string
  latestAssistantMessage: Message | null
  run: (options: RunOptions) => Promise<void>
  stop: () => void
  clear: () => void
}

export function useLightweightAssistantFlow(
  options: UseLightweightAssistantFlowOptions
): UseLightweightAssistantFlowResult {
  const { chatId, topicId, assistantId, onStreamStart } = options

  const [error, setError] = useState<string | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)
  const [completionState, setCompletionState] = useState<CompletionState>('idle')
  const [activeAssistant, setActiveAssistant] = useState<Assistant | null>(null)
  const timestampCacheRef = useRef(new Map<string, string>())

  const {
    messages,
    status,
    error: chatError,
    sendMessage,
    stop: stopChat,
    setMessages
  } = useAiChat({
    chatId,
    topicId,
    assistantId,
    onFinish: (_message, isAbort, isError) => {
      setIsPreparing(false)
      setCompletionState(isError ? 'error' : isAbort ? 'paused' : 'success')
    },
    onError: (streamError) => {
      setIsPreparing(false)
      setCompletionState('error')
      setError(streamError.message)
    }
  })

  useEffect(() => {
    if (status === 'streaming') {
      setIsPreparing(false)
      onStreamStart?.()
    }
  }, [status, onStreamStart])

  useEffect(() => {
    if (!chatError) return
    setCompletionState('error')
    setError(chatError.message)
  }, [chatError])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const message of messages) {
      map[message.id] = message.parts as CherryMessagePart[]
    }
    return map
  }, [messages])

  const latestAssistantUiMessage = useMemo<CherryUIMessage | undefined>(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages]
  )

  const adaptedMessages = useMemo<Message[]>(() => {
    const cache = timestampCacheRef.current
    const activeIds = new Set<string>()
    const latestAssistantId = latestAssistantUiMessage?.id

    const nextMessages = messages.map((message) => {
      activeIds.add(message.id)
      let createdAt = cache.get(message.id)
      if (!createdAt) {
        createdAt = new Date().toISOString()
        cache.set(message.id, createdAt)
      }

      let mappedStatus: Message['status']
      if (message.role === 'user') {
        mappedStatus = UserMessageStatus.SUCCESS
      } else if (message.id === latestAssistantId && (status === 'streaming' || status === 'submitted')) {
        mappedStatus = AssistantMessageStatus.PROCESSING
      } else if (message.id === latestAssistantId && completionState === 'paused') {
        mappedStatus = AssistantMessageStatus.PAUSED
      } else if (message.id === latestAssistantId && completionState === 'error') {
        mappedStatus = AssistantMessageStatus.ERROR
      } else {
        mappedStatus = AssistantMessageStatus.SUCCESS
      }

      return {
        id: message.id,
        role: message.role,
        assistantId: activeAssistant?.id ?? assistantId ?? '',
        topicId,
        createdAt,
        status: mappedStatus,
        blocks: []
      }
    })

    for (const key of cache.keys()) {
      if (!activeIds.has(key)) {
        cache.delete(key)
      }
    }

    return nextMessages
  }, [messages, latestAssistantUiMessage?.id, status, completionState, activeAssistant?.id, assistantId, topicId])

  const latestAssistantMessage = useMemo(
    () => adaptedMessages.findLast((message) => message.role === 'assistant') ?? null,
    [adaptedMessages]
  )

  const content = useMemo(
    () => (latestAssistantUiMessage ? getTextFromParts(latestAssistantUiMessage.parts as CherryMessagePart[]) : ''),
    [latestAssistantUiMessage]
  )

  const clear = useCallback(() => {
    void stopChat()
    setMessages([])
    setError(null)
    setIsPreparing(false)
    setCompletionState('idle')
  }, [setMessages, stopChat])

  const run = useCallback(
    async ({ assistant, prompt, extraBody, reset = true }: RunOptions) => {
      const model = assistant.model
      if (!model) {
        throw new Error('Assistant model is required.')
      }

      if (reset) {
        void stopChat()
        setMessages([])
      }
      setError(null)
      setIsPreparing(true)
      setCompletionState('running')
      setActiveAssistant(assistant)

      await sendMessage(
        { text: prompt },
        {
          body: {
            assistantId: assistant.id,
            providerId: model.provider,
            modelId: model.id,
            mcpToolIds: [],
            assistantOverrides: buildAssistantRuntimeOverrides(assistant),
            ...extraBody
          }
        }
      )
    },
    [sendMessage, setMessages, stopChat]
  )

  const stop = useCallback(() => {
    void stopChat()
  }, [stopChat])

  return {
    messages,
    adaptedMessages,
    partsMap,
    status,
    error,
    isPreparing,
    isStreaming: status === 'streaming' || status === 'submitted',
    content,
    latestAssistantMessage,
    run,
    stop,
    clear
  }
}
