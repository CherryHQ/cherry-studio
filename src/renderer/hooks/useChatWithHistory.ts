import { Chat, useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { ipcChatTransport } from '@renderer/services/aiTransport'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { ChatRequestOptions, FileUIPart } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useTopicDbRefreshOnAwaitingApproval } from './useTopicStreamStatus'
import { useTopicStreamStatus } from './useTopicStreamStatus'

const logger = loggerService.withContext('useChatWithHistory')

const EMPTY_EXECUTIONS: readonly ActiveExecution[] = Object.freeze([])

// ── Return type ──

export interface UseChatWithHistoryResult {
  sendMessage: (message?: { text: string; files?: FileUIPart[] }, options?: ChatRequestOptions) => Promise<void>
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  stop: () => Promise<void>
  error: Error | undefined
  status: ReturnType<typeof useChat<CherryUIMessage>>['status']
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  activeExecutions: readonly ActiveExecution[]
  chat: Chat<CherryUIMessage>
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>
): UseChatWithHistoryResult {
  const enabled = Boolean(topicId)
  // The topic id is the Chat instance identity. Initial messages seed only a
  // newly selected topic; history updates flow through the explicit adapters.
  const chat = useMemo(
    () =>
      new Chat<CherryUIMessage>({
        id: topicId,
        transport: ipcChatTransport,
        messages: initialMessages,
        onError: (streamError) => {
          logger.error('AI stream error', { topicId, streamError })
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topic identity alone owns the Chat lifecycle.
    [topicId]
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
    experimental_throttle: 0
  })

  const stop = useCallback(async () => {
    if (enabled) {
      void ipcApi.request('ai.stream_abort', { topicId }).catch((err) => {
        logger.warn('streamAbort failed', { topicId, err })
      })
    }
    await sdkStop()
  }, [enabled, sdkStop, topicId])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const { status: topicStreamStatus, activeExecutions: liveExecutions } = useTopicStreamStatus(topicId)
  const activeExecutions = liveExecutions.length > 0 ? liveExecutions : EMPTY_EXECUTIONS

  const resumeInFlightRef = useRef<{ token: symbol; topicId: string } | null>(null)

  const resumeActiveStream = useCallback(
    (reason: 'mount' | 'started-event') => {
      if (!enabled) return
      if (reason === 'mount' && (status === 'streaming' || status === 'submitted')) return
      if (resumeInFlightRef.current?.topicId === topicId) return

      const token = Symbol(topicId)
      resumeInFlightRef.current = { token, topicId }
      void (async () => {
        if (reason === 'started-event') {
          try {
            await refreshRef.current()
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
          if (resumeInFlightRef.current?.token === token) resumeInFlightRef.current = null
        })
    },
    [enabled, resumeStream, status, topicId]
  )

  useEffect(() => {
    resumeActiveStream('mount')
  }, [resumeActiveStream])

  // Approval pauses need the persisted row refreshed while the live card stays
  // visible. Final done/error/aborted refresh is handled by the page-level
  // overlay handoff so it can refresh before dropping live overlay parts.
  useTopicDbRefreshOnAwaitingApproval(topicId, refresh)

  // Resume-on-pending — distinct purpose from the invalidation signal: it
  // re-attaches a stream that started while this window was unmounted /
  // reloading. Stays here (it's tightly coupled to `resumeActiveStream` and
  // chat-specific) rather than mingling with the generic invalidation gate.
  const prevTopicStatusRef = useRef<{ status: typeof topicStreamStatus; topicId: string } | undefined>(undefined)
  useEffect(() => {
    const previous = prevTopicStatusRef.current
    const prev = previous?.topicId === topicId ? previous.status : undefined
    prevTopicStatusRef.current = { status: topicStreamStatus, topicId }
    if (!enabled) return
    if (topicStreamStatus === 'pending' && prev !== 'pending') {
      resumeActiveStream('started-event')
    }
  }, [enabled, resumeActiveStream, topicId, topicStreamStatus])

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
