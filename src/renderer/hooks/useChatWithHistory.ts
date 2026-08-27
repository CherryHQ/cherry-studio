import { Chat, useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { IpcChatTransport } from '@renderer/services/aiTransport'
import { type ConversationRef, conversationRefKey, ConversationStatus } from '@shared/ai/conversation'
import type { ConversationExecutionProjection } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { ChatRequestOptions, FileUIPart } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  useConversationDbRefreshOnAwaitingInteraction,
  useConversationStreamStatus
} from './useConversationStreamStatus'

const logger = loggerService.withContext('useChatWithHistory')

const EMPTY_EXECUTIONS: readonly ConversationExecutionProjection[] = Object.freeze([])

enum ResumeReason {
  Mount = 'mount',
  StartedEvent = 'started-event'
}

// ── Return type ──

export interface UseChatWithHistoryResult {
  sendMessage: (message?: { text: string; files?: FileUIPart[] }, options?: ChatRequestOptions) => Promise<void>
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  stop: () => Promise<void>
  error: Error | undefined
  status: ReturnType<typeof useChat<CherryUIMessage>>['status']
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  activeExecutions: readonly ConversationExecutionProjection[]
  chat: Chat<CherryUIMessage>
}

// ── Hook ──

export function useChatWithHistory(
  conversation: ConversationRef,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>
): UseChatWithHistoryResult {
  const scopeKey = conversationRefKey(conversation)
  const enabled = Boolean(conversation.id)
  const binding = useMemo(
    () => ({ conversation, selectionToken: Symbol(scopeKey) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value identity is the Conversation scope key.
    [scopeKey]
  )
  const chat = useMemo(
    () =>
      new Chat<CherryUIMessage>({
        id: scopeKey,
        transport: new IpcChatTransport({ conversation: binding.conversation }),
        messages: initialMessages,
        onError: (streamError) => {
          logger.error('AI stream error', { conversation: binding.conversation, streamError })
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topic identity alone owns the Chat lifecycle.
    [scopeKey]
  )

  const {
    setMessages,
    stop: sdkStop,
    status,
    error,
    sendMessage,
    regenerate,
    resumeStream
  } = useChat<CherryUIMessage>({
    chat,
    // Unthrottled (0) melts the renderer on long fast streams: every chunk re-notifies React
    // and re-renders/re-parses the growing message. 100ms keeps streaming visually smooth.
    experimental_throttle: 100
  })

  const stop = useCallback(async () => {
    const mainStop = enabled
      ? ipcApi.request('ai.stream.abort', { conversation: binding.conversation })
      : Promise.resolve()
    const localStop = sdkStop()
    const [mainResult, localResult] = await Promise.allSettled([mainStop, localStop])
    if (mainResult.status === 'rejected') throw mainResult.reason
    if (localResult.status === 'rejected') throw localResult.reason
  }, [binding, enabled, sdkStop])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const { status: conversationStatus, activeExecutions: liveExecutions } = useConversationStreamStatus(
    binding.conversation
  )
  const activeExecutions = liveExecutions.length > 0 ? liveExecutions : EMPTY_EXECUTIONS

  const conversationSelectionToken = binding.selectionToken
  const currentTopicSelectionTokenRef = useRef(conversationSelectionToken)
  currentTopicSelectionTokenRef.current = conversationSelectionToken
  const resumeInFlightRef = useRef<{ ownerToken: symbol; token: symbol } | null>(null)

  // `status` and `resumeStream` are read through refs so `resumeActiveStream`
  // keeps one identity per topic. With them in the deps, the "mount" effect
  // below re-fired on every SDK status change; when a resumed stream
  // terminated (closed or errored) while main still reported the stream as
  // attachable, each ready/error edge immediately re-attached — a hot
  // resume loop (attach IPC + stream setup + status flap per cycle) that
  // pegged the CPU. The refs also make the post-refresh status re-check read
  // the current value instead of a stale closure.
  const statusRef = useRef(status)
  statusRef.current = status
  const resumeStreamRef = useRef(resumeStream)
  resumeStreamRef.current = resumeStream

  const resumeActiveStream = useCallback(
    (reason: ResumeReason) => {
      if (!enabled) return
      if (reason === ResumeReason.Mount && (statusRef.current === 'streaming' || statusRef.current === 'submitted'))
        return
      if (resumeInFlightRef.current?.ownerToken === conversationSelectionToken && reason === ResumeReason.Mount) {
        return
      }

      const token = Symbol(scopeKey)
      resumeInFlightRef.current = { ownerToken: conversationSelectionToken, token }
      void (async () => {
        if (reason === ResumeReason.StartedEvent) {
          try {
            await refreshRef.current()
          } catch (err) {
            logger.warn('Failed to refresh messages before resuming stream', {
              conversation: binding.conversation,
              err
            })
          }
        }

        // A refresh started for topic A may settle after this hook has switched
        // to topic B. Do not let that stale task call B's latest resume callback.
        if (
          resumeInFlightRef.current?.token !== token ||
          currentTopicSelectionTokenRef.current !== conversationSelectionToken
        ) {
          return
        }

        if (statusRef.current === 'streaming' || statusRef.current === 'submitted') {
          return
        }

        await resumeStreamRef.current()
      })()
        .catch((err) => {
          logger.warn('Failed to resume active stream', { conversation: binding.conversation, reason, err })
        })
        .finally(() => {
          if (resumeInFlightRef.current?.token === token) resumeInFlightRef.current = null
        })
    },
    [binding, conversationSelectionToken, enabled, scopeKey]
  )

  // One attach attempt per topic selection — not per status change.
  useEffect(() => {
    resumeActiveStream(ResumeReason.Mount)
  }, [resumeActiveStream])

  // Approval pauses need the persisted row refreshed while the live card stays
  // visible. Final done/error/aborted refresh is handled by the page-level
  // overlay handoff so it can refresh before dropping live overlay parts.
  useConversationDbRefreshOnAwaitingInteraction(binding.conversation, refresh)

  // Resume-on-pending — distinct purpose from the invalidation signal: it
  // re-attaches a stream that started while this window was unmounted /
  // reloading. Stays here (it's tightly coupled to `resumeActiveStream` and
  // chat-specific) rather than mingling with the generic invalidation gate.
  const previousStatusRef = useRef<{ status: typeof conversationStatus; key: string } | undefined>(undefined)
  useEffect(() => {
    const previous = previousStatusRef.current
    const sameSelection = previous?.key === scopeKey
    const previousStatus = sameSelection ? previous.status : undefined
    previousStatusRef.current = { status: conversationStatus, key: scopeKey }
    if (!enabled || !sameSelection) return
    if (conversationStatus === ConversationStatus.Pending && previousStatus !== ConversationStatus.Pending) {
      resumeActiveStream(ResumeReason.StartedEvent)
    }
  }, [conversationStatus, enabled, resumeActiveStream, scopeKey])

  // PR 3: dropped the per-window `onStreamDone` / `onStreamError` IPC
  // listeners that previously called `refresh()` here. Final DB handoff now
  // belongs to the page-level overlay handoff; keeping it there avoids a
  // second producer of the same `mutate()` call.

  return {
    sendMessage,
    regenerate,
    stop,
    error,
    status,
    setMessages,
    activeExecutions,
    chat
  }
}
