import { useChat } from '@ai-sdk/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcChatTransport } from '@renderer/services/aiTransport'
import { autoReadService } from '@renderer/services/voice'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import { type CherryReasoningMeta, readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

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
 * are accumulated in `completedRounds` as each stream ends, which is what makes the
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
  const [isSaving, setIsSaving] = useState(false)
  // Read synchronously by send(): state would lag a follow-up submitted right after Save.
  const savingRef = useRef(false)
  /** The topic a save moved to SQLite; it belongs to the main window from then on. */
  const savedTopicIdRef = useRef<string | null>(null)

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
  const [autoReadEnabled] = usePreference('feature.voice.auto_read.enabled')
  // One model per turn and no branches here, so every execution is the answer on screen.
  const {
    liveAssistants,
    reset: resetExecutionMessages,
    clear: clearExecutionMessages
  } = useExecutionOverlay(chatId, activeExecutions, EMPTY_UI_MESSAGES, {
    onUpdate: (_executionId, event) =>
      autoReadService.update({ ...event, enabled: autoReadEnabled, scope: chatId, eligible: true }),
    onLeave: () => autoReadService.cancelScope(chatId),
    onFinish: (_executionId, { attemptId, message, isAbort, isError }) =>
      void autoReadService.consume({ enabled: autoReadEnabled, message, attemptId, isAbort, isError, eligible: true })
  })
  /** One entry per finished turn, holding every execution that turn produced — a
   *  multi-model send answers one user message with several assistant messages. */
  const [completedRounds, setCompletedRounds] = useState<CherryUIMessage[][]>([])
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
        setCompletedRounds((rounds) => [...rounds, finalizeLiveMessages(liveAssistants)])
        resetExecutionMessages()
      }
    }
  }, [activeExecutions, liveAssistants, resetExecutionMessages])

  useEffect(() => {
    if (isPending) setIsPreparing(false)
  }, [isPending])

  const topicIdRef = useRef(topicId)
  useEffect(() => {
    if (topicIdRef.current === topicId) return
    topicIdRef.current = topicId
    // A re-leased topic is a different conversation. The preference this hook keys on is
    // shared across windows, so the lease can turn over without this window asking —
    // which would otherwise leave the previous transcript on screen.
    setCompletedRounds([])
    setError(null)
    messageTimestampsRef.current.clear()
    clearExecutionMessages()
  }, [clearExecutionMessages, topicId])

  const rounds = useMemo<CherryUIMessage[][]>(
    () => (liveAssistants.length ? [...completedRounds, liveAssistants] : completedRounds),
    [completedRounds, liveAssistants]
  )
  const allAssistants = useMemo<CherryUIMessage[]>(() => rounds.flat(), [rounds])

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of [...chatMessages, ...allAssistants]) {
      next[message.id] = message.parts ?? []
    }
    return next
  }, [allAssistants, chatMessages])

  // Interleave user messages (from state.messages) with the turns they produced.
  // One user message per turn, but a turn holds every execution it started, so a
  // multi-model send lands all of its answers under the message that asked.
  // Temporary topics are always a clean linear chat, no branches.
  const displayMessages = useMemo<CherryUIMessage[]>(() => {
    const users = chatMessages.filter((m) => m.role === 'user')
    const liveRoundIndex = liveAssistants.length ? rounds.length - 1 : -1
    const out: CherryUIMessage[] = []
    const turns = Math.max(users.length, rounds.length)
    for (let i = 0; i < turns; i++) {
      const u = users[i]
      if (u) {
        out.push(u)
      }
      for (const a of rounds[i] ?? []) {
        out.push({
          ...a,
          metadata: {
            ...a.metadata,
            status: i === liveRoundIndex && isPending ? 'pending' : 'success'
          }
        })
      }
    }
    return out
  }, [chatMessages, rounds, liveAssistants, isPending])

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
    setCompletedRounds([])
    messageTimestampsRef.current.clear()
    clearExecutionMessages()
    setError(null)
    setIsPreparing(false)
  }, [clearExecutionMessages, setMessages, stopChat])

  /** Returns whether the turn was actually started, so callers can hold off on expanding. */
  const send = useCallback(
    (text: string, options?: QuickSendOptions): boolean => {
      // Main refuses a temporary-chat submit while a turn is in flight; say so up front, since
      // the stream itself is fire-and-forget and would report success either way.
      // While saving, a turn could dispatch against the promoted topic with no branch anchor,
      // only to be stopped when the save ends the conversation.
      if (!ready || !topicId || isPreparing || isPending || savingRef.current) return false
      // A submit that awaited file preparation across a save or reset holds a stale callback;
      // dispatching it would land on the persisted topic with no branch anchor.
      if (topicId !== topicIdRef.current || topicId === savedTopicIdRef.current) return false
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
    [isPending, isPreparing, ready, sendMessage, topicId]
  )

  const reset = useCallback(() => {
    // Drop the current temporary topic and let useTemporaryTopic lease a fresh one; the
    // effect above clears the transcript once the new lease lands.
    resetTemporaryTopic()
    clear()
  }, [clear, resetTemporaryTopic])

  /** Resolves whether the conversation on screen is the one that was saved. */
  const save = useCallback(async () => {
    const savingTopicId = topicIdRef.current
    savingRef.current = true
    setIsSaving(true)
    try {
      await persist()
      savedTopicIdRef.current = savingTopicId
      // Esc, collapse, or an assistant switch can drop the lease mid-request; the caller must
      // not then end the conversation the user has started since.
      return topicIdRef.current === savingTopicId
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }, [persist])

  return {
    topic,
    topicId,
    ready,
    messages,
    partsByMessageId,
    isLoading: isPreparing || isPending,
    isSaving,
    error,
    send,
    stop: stopChat,
    reset,
    save
  }
}
