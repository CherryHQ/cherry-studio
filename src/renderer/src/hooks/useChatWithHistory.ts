/**
 * Shared hook: useChat as single data source.
 *
 * History from DB is passed as `messages` (seeds Chat on topicId change).
 * useChat.messages is the sole rendering source — no merge, no dedup.
 * On stream done, DB is refreshed and setMessages replaces with truth.
 *
 * Used by:
 *   - V2ChatContent (normal chat, history from useTopicMessagesV2)
 *   - AgentChat (agent, history from useAgentSessionParts)
 */

import { useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Model } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import { cherryApprovalPredicate } from '@renderer/utils/toolApprovalPredicate'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ChatRequestOptions, ChatStatus } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useTopicStreamStatus } from './useTopicStreamStatus'

const logger = loggerService.withContext('useChatWithHistory')

// Module-level empty-array constant so the `?? []` fallback in
// `activeExecutionIds` keeps a stable reference when the cache is
// undefined. Prevents downstream memos / effects from invalidating on
// every render while no stream is active.
const EMPTY_EXECUTIONS: readonly UniqueModelId[] = Object.freeze([])

// ── Return type ──

export interface UseChatWithHistoryResult {
  adaptedMessages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
  sendMessage: (message?: { text: string }, options?: ChatRequestOptions) => Promise<void>
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  stop: () => Promise<void>
  status: ChatStatus
  error: Error | undefined
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  streamingUIMessages: CherryUIMessage[]
  activeExecutionIds: readonly UniqueModelId[]
  initialMessages: CherryUIMessage[]
  /**
   * AI SDK v6 native tool-approval response. Flips a `ToolUIPart` from
   * `approval-requested` to `approval-responded` on the local message.
   * For Claude Agent approvals the caller must also unblock Main via
   * `window.api.ai.toolApproval.respond` (see `useToolApprovalBridge`).
   */
  addToolApprovalResponse: (args: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>,
  context: { assistantId: string; defaultModelSnapshot?: ModelSnapshot }
): UseChatWithHistoryResult {
  const { messages, setMessages, stop, status, error, sendMessage, regenerate, resumeStream, addToolApprovalResponse } =
    useChat<CherryUIMessage>({
      id: topicId,
      transport: ipcChatTransport,
      messages: initialMessages,
      experimental_throttle: 50,
      sendAutomaticallyWhen: cherryApprovalPredicate,
      onError: (streamError) => {
        logger.error('AI stream error', { topicId, streamError })
      }
    })

  // Stable ref for refresh to avoid re-subscribing IPC listeners
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Active execution IDs for this topic come from the shared
  // `topic.stream.statuses` Record authored by Main's `AiStreamManager`.
  // An empty / missing entry means "no executions currently running".
  const { status: topicStreamStatus, activeExecutionIds: liveExecutionIds } = useTopicStreamStatus(topicId)
  const activeExecutionIds = liveExecutionIds.length > 0 ? liveExecutionIds : EMPTY_EXECUTIONS

  const resumeInFlightRef = useRef<Promise<void> | null>(null)
  const latestAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role === 'assistant') return message.id
    }
    return undefined
  }, [messages])

  const resumeActiveStream = useCallback(
    (reason: 'mount' | 'started-event') => {
      if (reason === 'mount' && (status === 'streaming' || status === 'submitted')) return
      if (resumeInFlightRef.current) return

      resumeInFlightRef.current = (async () => {
        if (reason === 'started-event') {
          // The `pending` broadcast reaches every window subscribed to this
          // topic — originator and passive observers alike. Both need the
          // SWR cache refreshed so `metadataMap` picks up the new DB row
          // (otherwise the placeholder renders with no model / createdAt
          // and the MessageHeader falls back to "D" / "Invalid Date"). The
          // difference is what to do with the returned filtered messages:
          //
          // - Originator (`submitted`/`streaming`): `useChat` already owns
          //   an `activeResponse` with the pre-allocated id; overwriting
          //   `state.messages` with the DB snapshot would detach the
          //   streaming bubble and trigger a duplicate `pushMessage` on
          //   the next chunk. Refresh the cache but skip `setMessages`.
          // - Passive observer (`ready`/`error`): no in-flight response,
          //   so swap state to the DB snapshot as usual.
          try {
            const refreshed = await refreshRef.current()
            if (status !== 'streaming' && status !== 'submitted') {
              setMessages(refreshed)
            }
          } catch (err) {
            logger.warn('Failed to refresh messages before resuming stream', { topicId, err })
          }
        }

        if (status === 'streaming' || status === 'submitted') {
          return
        }

        await resumeStream()
      })()
        .catch((err) => {
          logger.warn('Failed to resume active stream', { topicId, reason, err })
        })
        .finally(() => {
          resumeInFlightRef.current = null
        })
    },
    [resumeStream, setMessages, status, topicId]
  )

  useEffect(() => {
    resumeActiveStream('mount')
  }, [resumeActiveStream])

  // Trigger reattach when a new stream is created on this topic.
  // The `pending` transition uniquely marks "send() just created a new
  // ActiveStream"; downstream deltas (streaming / done / error /
  // aborted) describe an ongoing lifecycle and must not retrigger a
  // reattach. Reading `status` from the shared cache instead of a
  // custom IPC means we only need to guard against re-firing for the
  // same pending entry.
  const prevTopicStatusRef = useRef<typeof topicStreamStatus>(undefined)
  useEffect(() => {
    const prev = prevTopicStatusRef.current
    prevTopicStatusRef.current = topicStreamStatus
    if (topicStreamStatus === 'pending' && prev !== 'pending') {
      resumeActiveStream('started-event')
    }
  }, [resumeActiveStream, topicStreamStatus])

  const refreshAndReplace = useCallback(() => {
    void refreshRef
      .current()
      .then((refreshed) => {
        setMessages(refreshed)
      })
      .catch((err) => {
        logger.warn('Failed to refresh messages after stream end', { topicId, err })
      })
  }, [setMessages, topicId])

  // On stream done/error: replace messages with DB truth.
  //
  // Per-execution `done` events only trigger a refresh when the topic is
  // done — in a happy-path multi-model turn, all N executions succeed in
  // rapid succession and we let the topic-done event fold them into a
  // single refresh. Per-execution **error** events, however, are always
  // refreshed individually: an errored execution is terminal for that
  // bubble (the backend has already persisted `status='error'` + a
  // `data-error` part via PersistenceListener.mergeErrorIntoMessage) and
  // there's no guarantee the topic-done event will land soon — the
  // remaining executions may still be streaming. Without this refresh,
  // the errored bubble stays stuck on PENDING until the user switches
  // topics and comes back.
  useEffect(() => {
    const doneUnsub = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      if (data.executionId && !data.isTopicDone) return
      refreshAndReplace()
    })
    const errorUnsub = window.api.ai.onStreamError((data) => {
      if (data.topicId !== topicId) return
      refreshAndReplace()
    })
    return () => {
      doneUnsub()
      errorUnsub()
    }
  }, [topicId, refreshAndReplace])

  // AI SDK's `createStreamingUIMessageState` seeds `activeResponse.message`
  // with `{metadata: undefined}` on regenerate (and send, when the user
  // push happens before our placeholder microtask) — so the streaming
  // bubble would otherwise render with no avatar / "Invalid Date" until
  // the DB refresh on stream-done. We synthesise both fields from the
  // assistant's default model and a stable per-id timestamp so the UI
  // stays readable during the streaming window. Refresh replaces this
  // with DB truth at the end.
  const synthesizedCreatedAtRef = useRef<Map<string, string>>(new Map())
  const fallbackSnapshot = context.defaultModelSnapshot
  const fallbackModelId = useMemo(
    () => (fallbackSnapshot ? createUniqueModelId(fallbackSnapshot.provider, fallbackSnapshot.id) : undefined),
    [fallbackSnapshot]
  )

  // ── Adapt UIMessage[] to renderer Message[] ──
  //
  // Every field below comes straight off `uiMsg.metadata`. The branch
  // response projects all persisted columns onto it (see
  // `useTopicMessagesV2.toUIMessage`), and send / regenerate seed the
  // same shape onto their optimistic placeholders, so there's a single
  // source of truth per message instead of a parallel `metadataMap`
  // that lags `state.messages` during streaming.
  // TODO(v2): remove adaptedMessages after migrating to the new Message
  // type.
  const adaptedMessages = useMemo<Message[]>(() => {
    let lastUserId: string | undefined
    return messages.map((uiMsg) => {
      if (uiMsg.role === 'user') lastUserId = uiMsg.id
      const meta = uiMsg.metadata ?? {}

      const isAssistantStreaming = uiMsg.role === 'assistant' && !meta.createdAt
      let createdAt = meta.createdAt ?? ''
      if (isAssistantStreaming) {
        const cached = synthesizedCreatedAtRef.current.get(uiMsg.id)
        if (cached) {
          createdAt = cached
        } else {
          createdAt = new Date().toISOString()
          synthesizedCreatedAtRef.current.set(uiMsg.id, createdAt)
        }
      }

      const snapshot = meta.modelSnapshot ?? (isAssistantStreaming ? fallbackSnapshot : undefined)
      const modelId = meta.modelId ?? (isAssistantStreaming ? fallbackModelId : undefined)

      return {
        id: uiMsg.id,
        role: uiMsg.role,
        assistantId: context.assistantId,
        topicId,
        createdAt,
        askId: meta.parentId ?? (uiMsg.role === 'assistant' ? lastUserId : undefined),
        modelId,
        // `getModelLogo` reads `.provider`, `.id`, `.name` off the model;
        // `modelSnapshot` captures exactly that at reservation time, so
        // it doubles as a minimal `Model` for avatar rendering — stable
        // even if the live provider config later drops this model.
        model: snapshot ? (snapshot as unknown as Model) : undefined,
        siblingsGroupId: meta.siblingsGroupId,
        status:
          uiMsg.role === 'user'
            ? UserMessageStatus.SUCCESS
            : uiMsg.id === latestAssistantMessageId && status === 'submitted'
              ? AssistantMessageStatus.PENDING
              : uiMsg.id === latestAssistantMessageId && status === 'streaming'
                ? AssistantMessageStatus.PROCESSING
                : ((meta.status as AssistantMessageStatus | undefined) ?? AssistantMessageStatus.PENDING),
        ...(meta.stats && { usage: statsToUsage(meta.stats), metrics: statsToMetrics(meta.stats) }),
        blocks: []
      }
    })
  }, [messages, context.assistantId, topicId, status, latestAssistantMessageId, fallbackSnapshot, fallbackModelId])

  // ── PartsMap (direct from messages, no merge) ──

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const msg of messages) {
      map[msg.id] = msg.parts as CherryMessagePart[]
    }
    return map
  }, [messages])

  return {
    adaptedMessages,
    partsMap,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
    streamingUIMessages: messages,
    activeExecutionIds,
    initialMessages,
    addToolApprovalResponse
  }
}
