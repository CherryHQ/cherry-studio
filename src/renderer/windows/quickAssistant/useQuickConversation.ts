import { useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcChatTransport } from '@renderer/services/aiTransport'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import { type CherryReasoningMeta, readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useQuickConversation')

/** Stable empty array — the quick-assistant temp topic has no DB-backed messages. */
const EMPTY_UI_MESSAGES: CherryUIMessage[] = []
/** Placeholder chat id used while the temporary topic lease is still in flight. */
const PENDING_TOPIC_ID = 'pending-temp'

export interface QuickSendOptions {
  mentionedModels?: UniqueModelId[]
  userMessageParts?: CherryMessagePart[]
  reasoningEffort?: ReasoningEffortOption
  serviceTier?: ServiceTierSelection
  fastMode?: boolean
}

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

/**
 * The quick assistant's conversation: a temporary topic streamed through the same
 * transport as chat, projected into the shape `MessageList` renders.
 *
 * Chunks are routed to the per-execution collector, so `useChat.messages` only ever
 * holds the user turns `send` pushed — assistant turns arrive through the overlay and
 * are accumulated in `completedAssistants` as each stream ends, which is what makes the
 * multi-turn transcript survive.
 */
export function useQuickConversation({ assistantId }: { assistantId?: string }) {
  const {
    topicId,
    topic: temporaryTopic,
    ready,
    reset: resetTemporaryTopic,
    persist
  } = useTemporaryTopic({ enabled: true, assistantId })
  const chatId = topicId ?? PENDING_TOPIC_ID

  const [isPreparing, setIsPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)

  const {
    messages: chatMessages,
    sendMessage,
    stop: stopChat,
    setMessages
  } = useChat<CherryUIMessage>({
    id: chatId,
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (err) => {
      setIsPreparing(false)
      setError(err.message)
    }
  })

  const { activeExecutions, isPending } = useTopicStreamStatus(chatId)
  const {
    liveAssistants,
    reset: resetExecutionMessages,
    clear: clearExecutionMessages
  } = useExecutionOverlay(chatId, activeExecutions, EMPTY_UI_MESSAGES)
  const [completedAssistants, setCompletedAssistants] = useState<CherryUIMessage[]>([])
  /** First time each message id was projected, used as its display timestamp. */
  const messageTimestampsRef = useRef(new Map<string, string>())

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

  const messages = useMemo<MessageListItem[]>(
    () =>
      displayMessages.map((message) => {
        const item = toMessageListItem(message, { assistantId, topicId: topicId ?? '' })
        // Neither `useChat` turns nor overlay snapshots carry a timestamp — only rows read
        // back from SQLite do — and the message header would render "Invalid Date". Stamp
        // each id the first time it appears so the value stays stable across re-renders.
        if (item.createdAt) return item
        let seenAt = messageTimestampsRef.current.get(item.id)
        if (!seenAt) {
          seenAt = new Date().toISOString()
          messageTimestampsRef.current.set(item.id, seenAt)
        }
        return { ...item, createdAt: seenAt }
      }),
    [assistantId, displayMessages, topicId]
  )

  // MessageList needs a topic row; the temporary one carries no messages of its own
  // (they live in main's in-memory store until `persist`).
  const topic = useMemo<Topic>(
    () => ({
      id: chatId,
      name: '',
      lastActivityAt: '',
      createdAt: '',
      updatedAt: '',
      ...temporaryTopic,
      assistantId: temporaryTopic?.assistantId ?? assistantId,
      messages: []
    }),
    [assistantId, chatId, temporaryTopic]
  )

  const clear = useCallback(() => {
    void stopChat()
    setMessages([])
    setCompletedAssistants([])
    messageTimestampsRef.current.clear()
    clearExecutionMessages()
    setError(null)
    setIsPreparing(false)
  }, [clearExecutionMessages, setMessages, stopChat])

  /** Returns whether the turn was actually started, so callers can hold off on expanding. */
  const send = useCallback(
    (text: string, options?: QuickSendOptions): boolean => {
      if (!ready || !topicId) return false
      const parts = options?.userMessageParts ?? [{ type: 'text' as const, text }]
      if (parts.length === 0) return false

      setError(null)
      setIsPreparing(true)
      try {
        // Main resolves an assistant-bound topic or the explicit model-only selection.
        void sendMessage(
          { parts },
          {
            body: {
              mentionedModels: options?.mentionedModels,
              reasoningEffort: options?.reasoningEffort,
              serviceTier: options?.serviceTier,
              ...(options?.fastMode ? { fastMode: true as const } : {})
            }
          }
        )
      } catch (streamError) {
        const resolved = streamError instanceof Error ? streamError : new Error('An error occurred')
        setIsPreparing(false)
        setError(resolved.message)
        logger.error('Failed to start the quick assistant stream', resolved)
      }
      return true
    },
    [ready, sendMessage, topicId]
  )

  const reset = useCallback(() => {
    // Drop the current temporary topic and let useTemporaryTopic lease a fresh one.
    resetTemporaryTopic()
    setIsSaved(false)
    clear()
  }, [clear, resetTemporaryTopic])

  const save = useCallback(async () => {
    await persist()
    setIsSaved(true)
  }, [persist])

  return {
    topic,
    topicId,
    ready,
    messages,
    partsByMessageId,
    isLoading: isPreparing || isPending,
    isSaved,
    error,
    send,
    stop: stopChat,
    reset,
    save
  }
}
